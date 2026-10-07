import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useCommand } from "@/context/command"
import { scheduleTranslation, translationError, translationSource } from "./skill-translation"
import { useSDK } from "@/context/sdk"
import { Schema } from "effect"
import { createEffect, onMount, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { usePrompt, type PromptModel } from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { useTabs, type Tab } from "@/context/tabs"
import { useServer, ServerConnection } from "@/context/server"
import type { SkillTaskTarget } from "@/context/skill-discovery-state"
import { useNavigate } from "@solidjs/router"
import { ToolRegistry, type ToolProps } from "@opencode-ai/session-ui/message-part"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import {
  Candidate,
  Operation,
  ReadResult,
  type ReadSource,
  type Selectable,
  type Preview,
  Translation,
  type TranslationSource,
} from "@opencode-ai/schema/skill-library"
import "./skill-library.css"

function useSkillTask() {
  const layout = useLayout()
  const tabs = useTabs()
  const server = useServer()
  const sdk = useServerSDK()
  const current = (): Tab | undefined => {
    const route = layout.route()
    if (route.type === "draft") return tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)
    if (route.type === "session")
      return { type: "session", server: route.server ?? ServerConnection.key(sdk().server), sessionId: route.sessionId }
    return undefined
  }
  return {
    current,
    target: (directory?: string): SkillTaskTarget | undefined => {
      const tab = current()
      if (!tab) return undefined
      return { tab, directory: directory ?? (tab.type === "draft" ? tab.directory : (server.projects.last() ?? "")) }
    },
  }
}

type DisplaySkill = Selectable & {
  translation?: Translation
  translationError?: ReturnType<typeof translationError>
  translating?: boolean
}

function useSkills(
  directory?: string,
  translateWhen: () => boolean = () => true,
  model: () => PromptModel | undefined = () => undefined,
) {
  const sdk = useServerSDK()
  const [state, setState] = createStore({ error: "", loading: false, items: [] as DisplaySkill[] })
  let generation = 0
  const translate = async (item: DisplaySkill, token: number) => {
    const current = () => token === generation
    const selectedModel = model()
    if (!current()) return
    setState("items", (entry) => entry.id === item.id, { translating: true, translationError: undefined })
    try {
      const result = await scheduleTranslation(
        () =>
          sdk().client.v2.skill.translate(
            {
              location: directory ? { directory } : undefined,
              source: translationSource(item),
              includeMarkdown: false,
              ...(selectedModel
                ? { model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID } }
                : {}),
            },
            { throwOnError: true },
          ),
        current,
      )
      if (current())
        setState(
          "items",
          (entry) => entry.id === item.id,
          "translation",
          Schema.decodeUnknownSync(Translation)(result.data.data),
        )
    } catch (cause) {
      if (current()) setState("items", (entry) => entry.id === item.id, "translationError", translationError(cause))
    } finally {
      if (current()) setState("items", (entry) => entry.id === item.id, "translating", false)
    }
  }
  const refetch = async () => {
    if (!translateWhen()) return
    const token = ++generation
    setState({ error: "", loading: true })
    try {
      const result = await sdk().client.v2.skill.available(
        { location: directory ? { directory } : undefined },
        { throwOnError: true },
      )
      if (token !== generation) return
      setState(
        "items",
        result.data.data.map((item): DisplaySkill => ({ ...item })),
      )
      for (const item of state.items) void translate(item, token)
    } catch (cause) {
      if (token === generation) setState("error", message(cause))
    } finally {
      if (token === generation) setState("loading", false)
    }
  }
  createEffect(() => {
    model()
    if (translateWhen()) void refetch()
    else generation++
  })
  onCleanup(() => generation++)
  const unsubscribe = sdk().event.listen(({ details }) => {
    if (
      details?.current?.type.endsWith("tool.success") ||
      (details?.type === "message.part.updated" &&
        details.properties.part.type === "tool" &&
        ["install_skill", "remove_skill"].includes(details.properties.part.tool) &&
        details.properties.part.state.status === "completed")
    )
      void refetch()
  })
  onCleanup(unsubscribe)
  return {
    items: () => state.items,
    refetch,
    state,
    retry: (item: DisplaySkill) => (item.translationError === "changed" ? refetch() : translate(item, generation)),
  }
}

function message(cause: unknown) {
  if (cause instanceof Error) return cause.message
  if (cause && typeof cause === "object" && "message" in cause) return String(cause.message)
  return JSON.stringify(cause)
}

function TranslationFailure(props: { reason: ReturnType<typeof translationError>; retry: () => void; busy?: boolean }) {
  const language = useLanguage()
  const command = useCommand()
  return (
    <div class="skill-translation-failure" role="status">
      <span>{language.t(`skills.translationError.${props.reason}`)}</span>
      <ButtonV2 variant="ghost" class="skill-link" disabled={props.busy} onClick={props.retry}>
        {language.t("skills.retryTranslation")}
      </ButtonV2>
      <Show when={props.reason === "model"}>
        <ButtonV2 variant="ghost" class="skill-link" onClick={() => command.trigger("settings.open")}>
          {language.t("command.settings.open")}
        </ButtonV2>
      </Show>
    </div>
  )
}

function SkillDetails(props: { item: DisplaySkill }) {
  const sdk = useServerSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    item: props.item,
    original: "",
    originalReady: false,
    translation: props.item.translation,
    busy: false,
    showOriginal: false,
    error: undefined as ReturnType<typeof translationError> | undefined,
  })
  let alive = true
  onCleanup(() => (alive = false))
  const load = async () => {
    if (state.busy) return
    const refresh = state.error === "changed"
    setState({ busy: true, error: undefined })
    try {
      if (refresh) {
        const available = await sdk().client.v2.skill.available({}, { throwOnError: true })
        if (!alive) return
        const item = available.data.data.find((item) => item.id === state.item.id)
        if (!item) throw new Error("NOT_FOUND")
        setState("item", item)
      }
      const source = translationSource(state.item)
      const original = await sdk().client.v2.skill.content({ source }, { throwOnError: true })
      if (!alive) return
      setState({ original: original.data.data.skillMarkdown, originalReady: true })
      const translated = await scheduleTranslation(
        () => sdk().client.v2.skill.translate({ source, includeMarkdown: true }, { throwOnError: true }),
        () => alive,
      )
      if (alive) setState("translation", Schema.decodeUnknownSync(Translation)(translated.data.data))
    } catch (cause) {
      if (alive) setState("error", translationError(cause))
    } finally {
      if (alive) setState("busy", false)
    }
  }
  onMount(() => void load())
  return (
    <Dialog title={state.translation?.name ?? state.item.name}>
      <div class="skill-details">
        <small>{state.item.name}</small>
        <p>
          {state.showOriginal ? state.item.description : (state.translation?.description ?? state.item.description)}
        </p>
        <ButtonV2 variant="ghost" class="skill-link" onClick={() => setState("showOriginal", !state.showOriginal)}>
          {state.showOriginal ? language.t("skills.showTranslation") : language.t("skills.showOriginal")}
        </ButtonV2>
        <Show when={state.busy}>
          <p role="status">{language.t("skills.translating")}</p>
        </Show>
        <Show when={state.error}>
          <TranslationFailure reason={state.error!} retry={() => void load()} busy={state.busy} />
        </Show>
        <Show when={state.originalReady}>
          <pre class="skill-document">
            {state.showOriginal ? state.original : (state.translation?.skillMarkdown ?? state.original)}
          </pre>
        </Show>
        <dl>
          <dt>{language.t("skills.source")}</dt>
          <dd>
            {state.item.repository} / {state.item.path}
          </dd>
          <Show when={state.item.revision}>
            <dt>{language.t("skills.version")}</dt>
            <dd>{state.item.revision}</dd>
          </Show>
        </dl>
      </div>
    </Dialog>
  )
}

export function SkillLibraryPage() {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useServerSDK()
  const skills = useSkills(undefined, () => true)
  const [state, setState] = createStore({ filter: "", error: "", removing: "" })
  const filtered = () =>
    (skills.items() ?? []).filter((item) =>
      `${item.translation?.name ?? item.name} ${item.translation?.description ?? item.description} ${item.name} ${item.description}`
        .toLowerCase()
        .includes(state.filter.toLowerCase()),
    )
  const details = (item: DisplaySkill) => dialog.show(() => <SkillDetails item={item} />)
  const row = (item: DisplaySkill) => (
    <div class="skill-row" data-skill-id={item.id}>
      <Icon name="code" size="large" />
      <div class="skill-row-copy">
        <strong>{item.translation?.name ?? item.name}</strong>
        <Show when={item.translation}>
          <small class="skill-original-id">{item.name}</small>
        </Show>
        <p title={item.translation?.description ?? item.description}>
          {item.translation?.description ?? item.description}
        </p>
        <Show when={item.translationError}>
          <TranslationFailure
            reason={item.translationError!}
            busy={item.translating}
            retry={() => void skills.retry(item)}
          />
        </Show>
      </div>
      <ButtonV2 variant="neutral" class="skill-button" onClick={() => details(item)}>
        {language.t("skills.details")}
      </ButtonV2>
      <Show when={item.translating}>
        <small role="status">{language.t("skills.translating")}</small>
      </Show>
      <Show when={item.managed}>
        <ButtonV2
          variant="ghost"
          class="skill-link"
          disabled={!!state.removing}
          onClick={async () => {
            setState({ error: "", removing: item.id })
            try {
              await sdk().client.v2.skill.remove({ id: item.id }, { throwOnError: true })
              await skills.refetch()
            } catch (cause) {
              setState("error", message(cause))
            } finally {
              setState("removing", "")
            }
          }}
        >
          {language.t("skills.remove")}
        </ButtonV2>
      </Show>
    </div>
  )
  return (
    <main class="skill-page" data-component="campus-home" data-testid="skill-library-page">
      <div class="skill-page-content">
        <header>
          <div>
            <h1>{language.t("skills.title")}</h1>
            <p>{language.t("skills.librarySubtitle")}</p>
            <p class="skill-muted">{language.t("skills.translationNotice")}</p>
          </div>
          <ButtonV2
            variant="contrast"
            class="skill-button skill-primary"
            onClick={() => dialog.show(() => <SkillInstallDialog onInstalled={() => void skills.refetch()} />)}
          >
            <Icon name="plus" />
            {language.t("skills.installNew")}
          </ButtonV2>
        </header>
        <input
          class="skill-input skill-library-search"
          placeholder={language.t("skills.installedSearch")}
          aria-label={language.t("skills.installedSearch")}
          value={state.filter}
          onInput={(e) => setState("filter", e.currentTarget.value)}
        />
        <Show when={skills.state.loading}>
          <p role="status">{language.t("skills.loading")}</p>
        </Show>
        <Show when={state.error || skills.state.error}>
          <p role="alert">{state.error || skills.state.error}</p>
        </Show>
        <div class="skill-list">
          <For each={filtered().filter((item) => item.managed)}>{row}</For>
        </div>
        <Show when={!skills.state.loading && !filtered().some((item) => item.managed)}>
          <div class="skill-empty">{language.t("skills.empty")}</div>
        </Show>
        <details class="skill-secondary-list">
          <summary>{language.t("skills.projectBuiltin")}</summary>
          <For each={filtered().filter((item) => !item.managed)}>{row}</For>
        </details>
      </div>
    </main>
  )
}

export function SkillInstallDialog(props: {
  target?: SkillTaskTarget
  model?: () => PromptModel | undefined
  onInstalled?: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatform()
  const sdk = useServerSDK()
  const server = useServer()
  const tabs = useTabs()
  const [state, setState] = createStore({
    url: "",
    candidates: [] as Candidate[],
    searched: false,
    busy: false,
    error: "",
    read: undefined as ReadResult | undefined,
    translation: undefined as Translation | undefined,
    translating: false,
    translationError: undefined as ReturnType<typeof translationError> | undefined,
    showOriginal: false,
    operation: undefined as Operation | undefined,
    local: false,
  })
  let generation = 0
  let timer: ReturnType<typeof setInterval> | undefined
  onCleanup(() => {
    generation++
    clearInterval(timer)
  })
  const requestTranslation = async (source: TranslationSource, includeMarkdown: boolean, token: number) => {
    setState({ translating: true, translationError: undefined })
    const selectedModel = props.model?.()
    try {
      const result = await scheduleTranslation(
        () =>
          sdk().client.v2.skill.translate(
            {
              source,
              includeMarkdown,
              ...(selectedModel
                ? { model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID } }
                : {}),
            },
            { throwOnError: true },
          ),
        () => token === generation,
      )
      if (token !== generation) return
      const translated = Schema.decodeUnknownSync(Translation)(result.data.data)
      setState("translation", {
        ...translated,
        ...(translated.skillMarkdown === undefined && state.translation?.skillMarkdown
          ? { skillMarkdown: state.translation.skillMarkdown }
          : {}),
      })
    } catch (cause) {
      if (token === generation) setState("translationError", translationError(cause))
    } finally {
      if (token === generation) setState("translating", false)
    }
  }
  const read = async (source: ReadSource) => {
    if (state.busy) return
    const token = ++generation
    setState({
      busy: true,
      error: "",
      read: undefined,
      translation: undefined,
      translating: false,
      translationError: undefined as ReturnType<typeof translationError> | undefined,
      showOriginal: false,
      operation: undefined,
    })
    try {
      const result = await sdk().client.v2.skill.read({ source }, { throwOnError: true })
      if (token === generation) {
        const decoded = Schema.decodeUnknownSync(ReadResult)(result.data.data)
        setState("read", decoded)
        if (decoded.type === "preview")
          void requestTranslation({ type: "preview", previewId: decoded.preview.previewId }, false, token)
      }
    } catch (cause) {
      if (token === generation) setState("error", message(cause))
    } finally {
      if (token === generation) setState("busy", false)
    }
  }
  const search = async () => {
    const q = state.url.trim()
    if (!q || state.busy) return
    if (/^https?:\/\//i.test(q)) return read({ type: "url", url: q })
    const token = ++generation
    setState({ busy: true, error: "", candidates: [], searched: false, read: undefined, operation: undefined })
    try {
      const result = await sdk().client.v2.skill.search({ q }, { throwOnError: true })
      if (token === generation)
        setState({
          candidates: Schema.decodeUnknownSync(Schema.Array(Candidate))(result.data.data).map((item) => ({ ...item })),
          searched: true,
        })
    } catch (cause) {
      if (token === generation) setState("error", message(cause))
    } finally {
      if (token === generation) setState("busy", false)
    }
  }
  const preview = () => (state.read?.type === "preview" ? state.read.preview : undefined)
  const install = async (item: Preview) => {
    if (state.busy) return
    const token = ++generation
    const id = crypto.randomUUID()
    setState({ busy: true, error: "", operation: undefined })
    timer = setInterval(
      () =>
        void sdk()
          .client.v2.skill.operation({ id }, { throwOnError: true })
          .then((value) => {
            if (token !== generation || !value.data.data) return
            const next = Schema.decodeUnknownSync(Operation)(value.data.data)
            if (
              !state.operation ||
              (!["completed", "failed"].includes(state.operation.stage) && state.operation.updatedAt <= next.updatedAt)
            )
              setState("operation", next)
          })
          .catch(() => {}),
      500,
    )
    try {
      const result = await sdk().client.v2.skill.install(
        { id, source: { type: "preview", previewId: item.previewId } },
        { throwOnError: true },
      )
      if (token !== generation) return
      setState("operation", Schema.decodeUnknownSync(Operation)(result.data.data))
      if (state.operation?.stage === "completed") props.onInstalled?.()
    } catch (cause) {
      if (token === generation) setState("error", message(cause))
    } finally {
      clearInterval(timer)
      if (token === generation) setState("busy", false)
    }
  }
  const discover = async () => {
    setState({ busy: true, error: "" })
    try {
      await tabs.newSkillDiscovery(
        props.target,
        props.target?.directory || server.projects.last() || ".",
        language.t("skills.discoveryPrompt"),
        props.model?.(),
      )
      dialog.close()
    } catch (cause) {
      setState({ error: message(cause), busy: false })
    }
  }
  return (
    <Dialog title={language.t("skills.installNew")} class="skill-install-dialog">
      <div class="skill-install" data-testid="skill-install-dialog">
        <p class="skill-muted">{language.t("skills.installSubtitle")}</p>
        <p class="skill-muted">{language.t("skills.translationNotice")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <label for="skill-source-url">{language.t("skills.search")}</label>
          <div class="skill-source-line">
            <input
              id="skill-source-url"
              autofocus
              class="skill-input"
              placeholder={language.t("skills.search")}
              value={state.url}
              disabled={state.busy}
              onInput={(e) => {
                generation++
                setState({
                  url: e.currentTarget.value,
                  read: undefined,
                  operation: undefined,
                  error: "",
                  candidates: [],
                  searched: false,
                })
              }}
            />
            <ButtonV2
              type="submit"
              variant="contrast"
              class="skill-button skill-primary"
              disabled={state.busy || !state.url.trim()}
            >
              {language.t("skills.searchAction")}
            </ButtonV2>
          </div>
          <small class="skill-muted">{language.t("skills.readHint")}</small>
        </form>
        <Show when={state.searched}>
          <div class="skill-candidates" data-testid="skill-search-results">
            <For each={state.candidates}>
              {(item) => (
                <button
                  type="button"
                  class="skill-candidate"
                  disabled={state.busy}
                  onClick={() => void read({ type: "registry", id: item.id, revision: item.revision })}
                >
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                  <span>{language.t("skills.read")}</span>
                </button>
              )}
            </For>
            <Show when={!state.candidates.length}>
              <p class="skill-muted">{language.t("skills.empty")}</p>
            </Show>
          </div>
        </Show>
        <Show when={state.read?.type === "candidates" ? state.read.candidates : undefined}>
          {(items) => (
            <div class="skill-candidates">
              <p>{language.t("skills.chooseCandidate")}</p>
              <For each={items()}>
                {(item) => (
                  <button
                    class="skill-candidate"
                    disabled={state.busy}
                    onClick={() => void read({ type: "candidate", candidate: item })}
                  >
                    <strong>{item.path || item.repository}</strong>
                    <small>
                      {item.repository} · {item.upstreamRevision.slice(0, 12)}
                    </small>
                    <span>{language.t("skills.read")}</span>
                  </button>
                )}
              </For>
            </div>
          )}
        </Show>
        <Show when={preview()}>
          {(item) => (
            <section class="skill-preview" data-testid="skill-preview">
              <strong>{state.translation?.name ?? item().name}</strong>
              <p>{state.translation?.description ?? item().description}</p>
              <Show when={state.translating}>
                <p role="status" class="skill-muted">
                  {language.t("skills.translating")}
                </p>
              </Show>
              <Show when={state.translationError}>
                <TranslationFailure
                  reason={state.translationError!}
                  busy={state.translating}
                  retry={() =>
                    void requestTranslation({ type: "preview", previewId: item().previewId }, true, generation)
                  }
                />
              </Show>
              <small class="skill-muted">
                {item().repository} / {item().path}
              </small>
              <details
                onToggle={(event) => {
                  if (event.currentTarget.open && !state.translation?.skillMarkdown)
                    void requestTranslation({ type: "preview", previewId: item().previewId }, true, generation)
                }}
              >
                <summary>{language.t("skills.checkedDetails")}</summary>
                <p>
                  {language.t("skills.version")}: {item().revision}
                </p>
                <p>
                  {language.t("skills.upstreamRevision")}: {item().upstreamRevision}
                </p>
                <ButtonV2
                  variant="ghost"
                  type="button"
                  class="skill-link"
                  onClick={() => setState("showOriginal", !state.showOriginal)}
                >
                  {state.showOriginal ? language.t("skills.showTranslation") : language.t("skills.showOriginal")}
                </ButtonV2>
                <Show when={!state.showOriginal && !state.translation?.skillMarkdown && !state.translationError}>
                  <p role="status" class="skill-muted">
                    {language.t("skills.translating")}
                  </p>
                </Show>
                <Show when={state.showOriginal || state.translation?.skillMarkdown || state.translationError}>
                  <pre>
                    {state.showOriginal || !state.translation?.skillMarkdown
                      ? item().skillMarkdown
                      : state.translation.skillMarkdown}
                  </pre>
                </Show>
              </details>
              <Show when={state.operation?.stage !== "completed"}>
                <ButtonV2
                  variant="contrast"
                  class="skill-button skill-primary"
                  disabled={state.busy}
                  onClick={() => void install(item())}
                >
                  {language.t("skills.install")}
                </ButtonV2>
              </Show>
            </section>
          )}
        </Show>
        <Show when={state.busy || state.operation}>
          <p role="status">{language.t(`skills.stage.${state.operation?.stage ?? "resolving"}`)}</p>
        </Show>
        <Show when={state.error || state.operation?.error}>
          <p role="alert">{state.error || state.operation?.error?.message}</p>
        </Show>
        <Show when={state.operation?.stage === "completed"}>
          <div class="skill-actions">
            <Show when={props.target}>
              <ButtonV2
                variant="contrast"
                class="skill-button skill-primary"
                onClick={() => {
                  if (props.target && state.operation?.result) tabs.addSkillToTask(props.target, state.operation.result)
                  dialog.close()
                }}
              >
                {language.t("skills.addToTask")}
              </ButtonV2>
            </Show>
            <ButtonV2 variant="neutral" class="skill-button" onClick={() => dialog.close()}>
              {language.t("skills.done")}
            </ButtonV2>
          </div>
        </Show>
        <button class="skill-discover" disabled={state.busy} onClick={() => void discover()}>
          <Icon name="brain" size="large" />
          <span>
            <strong>{language.t("skills.askAI")}</strong>
            <small>{language.t("skills.askAIHint")}</small>
          </span>
          <Icon name="chevron-right" />
        </button>
        <ButtonV2
          variant="ghost"
          class="skill-link"
          disabled={state.busy}
          onClick={() => setState("local", !state.local)}
        >
          <Icon name="folder" />
          {language.t("skills.importComputer")}
        </ButtonV2>
        <Show when={state.local && platform.platform === "desktop"}>
          <div class="skill-actions">
            <ButtonV2
              variant="neutral"
              class="skill-button"
              disabled={state.busy}
              onClick={async () => {
                if (platform.platform !== "desktop") return
                const picked = await platform.openDirectoryPickerDialog({ title: language.t("skills.folder") })
                const path = Array.isArray(picked) ? picked[0] : picked
                if (path) await read({ type: "local", path })
              }}
            >
              {language.t("skills.folder")}
            </ButtonV2>
            <ButtonV2
              variant="neutral"
              class="skill-button"
              disabled={state.busy}
              onClick={async () => {
                if (platform.platform !== "desktop") return
                const path = await platform.openSkillZipPickerDialog?.({ title: language.t("skills.zip") })
                if (path) await read({ type: "local", path })
              }}
            >
              {language.t("skills.zip")}
            </ButtonV2>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

export function SkillSelectionSummary(props: { selection: ReturnType<typeof usePrompt>["skills"] }) {
  const prompt = usePrompt()
  const task = useSkillTask()
  const tabs = useTabs()
  const language = useLanguage()
  createEffect(() => {
    const tab = task.current()
    if (!tab || !tabs.skillsReady() || !prompt.ready()) return
    const pending = tabs.pendingSkills(tab)
    if (!pending.length) return
    for (const skill of pending) props.selection.add(skill)
    tabs.acknowledgeSkills(tab)
  })

  return (
    <Show when={props.selection.current().length}>
      <div class="skill-chips" data-testid="selected-skills">
        <For each={props.selection.current()}>
          {(item) => (
            <button
              type="button"
              class="skill-chip"
              title={language.t("skills.unselect")}
              onClick={() => props.selection.remove(item.id)}
            >
              {item.name}
              <Icon name="close" size="small" />
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}

export function SkillSelector(props: { selection: ReturnType<typeof usePrompt>["skills"] }) {
  const sdk = useSDK()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()
  const task = useSkillTask()
  const tabs = useTabs()
  const [state, setState] = createStore({ open: true, filter: "" })
  const skills = useSkills(
    sdk().directory,
    () => state.open,
    () => prompt.model.current(),
  )
  const discovery = () => {
    const tab = task.current()
    return tab && tabs.skillDiscovery(tab)
  }
  const rows = () =>
    (skills.items() ?? []).filter((item) =>
      `${item.translation?.name ?? item.name} ${item.translation?.description ?? item.description} ${item.name} ${item.description}`
        .toLowerCase()
        .includes(state.filter.toLowerCase()),
    )
  return (
    <Dialog title={language.t("skills.chooseTitle")}>
      <div class="skill-selector-dialog" data-testid="skill-selector">
        <Show when={discovery()}>
          <div class="skill-discovery-banner">
            <span>{language.t("skills.discoveryTitle")}</span>
            <Show when={discovery()?.origin}>
              <ButtonV2
                variant="ghost"
                class="skill-link"
                onClick={() => {
                  const tab = task.current()
                  if (tab) void tabs.returnFromSkillDiscovery(tab)
                }}
              >
                {language.t("skills.returnTask")}
              </ButtonV2>
            </Show>
          </div>
        </Show>

        <p class="skill-muted">{language.t("skills.translationNotice")}</p>
        <input
          class="skill-input"
          autofocus
          placeholder={language.t("skills.installedSearch")}
          aria-label={language.t("skills.installedSearch")}
          value={state.filter}
          onInput={(e) => setState("filter", e.currentTarget.value)}
        />
        <div class="skill-picker-list">
          <For each={rows().filter((item) => item.managed)}>
            {(item) => (
              <button
                type="button"
                role="checkbox"
                class="skill-picker-row"
                aria-checked={props.selection.current().some((selected) => selected.id === item.id)}
                onClick={() =>
                  props.selection.current().some((selected) => selected.id === item.id)
                    ? props.selection.remove(item.id)
                    : props.selection.add({ ...item, name: item.translation?.name ?? item.name })
                }
              >
                <Icon name="code" />
                <span>
                  <strong>{item.translation?.name ?? item.name}</strong>
                  <Show when={item.translation}>
                    <small>{item.name}</small>
                  </Show>
                  <small title={item.translation?.description ?? item.description}>
                    {item.translation?.description ?? item.description}
                  </small>
                </span>
                <span
                  class="skill-check"
                  data-checked={props.selection.current().some((selected) => selected.id === item.id)}
                >
                  <Show when={props.selection.current().some((selected) => selected.id === item.id)}>
                    <Icon name="check" size="small" />
                  </Show>
                </span>
              </button>
            )}
          </For>
          <details class="skill-picker-extra" open={!!state.filter}>
            <summary>{language.t("skills.projectBuiltin")}</summary>
            <For each={rows().filter((item) => !item.managed)}>
              {(item) => (
                <button
                  type="button"
                  role="checkbox"
                  class="skill-picker-row"
                  aria-checked={props.selection.current().some((selected) => selected.id === item.id)}
                  onClick={() =>
                    props.selection.current().some((selected) => selected.id === item.id)
                      ? props.selection.remove(item.id)
                      : props.selection.add({ ...item, name: item.translation?.name ?? item.name })
                  }
                >
                  <Icon name="code" />
                  <span>
                    <strong>{item.translation?.name ?? item.name}</strong>
                    <small>{item.translation ? item.name : ""}</small>
                    <small title={item.translation?.description ?? item.description}>
                      {item.translation?.description ?? item.description}
                    </small>
                  </span>
                  <span
                    class="skill-check"
                    data-checked={props.selection.current().some((selected) => selected.id === item.id)}
                  >
                    <Show when={props.selection.current().some((selected) => selected.id === item.id)}>
                      <Icon name="check" size="small" />
                    </Show>
                  </span>
                </button>
              )}
            </For>
          </details>
          <Show when={!rows().length}>
            <p class="skill-empty">{language.t("skills.empty")}</p>
          </Show>
        </div>
        <For each={rows().filter((item) => item.translationError)}>
          {(item) => (
            <div class="skill-translation-failure">
              <span>{item.name}</span>
              <TranslationFailure
                reason={item.translationError!}
                busy={item.translating}
                retry={() => void skills.retry(item)}
              />
            </div>
          )}
        </For>
        <Show when={skills.state.error}>
          <p role="alert">{skills.state.error}</p>
        </Show>
        <button
          class="skill-picker-install"
          onClick={() => {
            const target = task.target(sdk().directory)
            setState("open", false)
            void dialog.show(() => (
              <SkillInstallDialog
                target={target}
                model={() => prompt.model.current()}
                onInstalled={() => void skills.refetch()}
              />
            ))
          }}
        >
          <Icon name="plus" />
          {language.t("skills.installNew")}
        </button>
      </div>
    </Dialog>
  )
}

function SkillInstallResult(props: ToolProps) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const tabs = useTabs()
  const task = useSkillTask()
  const navigate = useNavigate()
  const [state, setState] = createStore({ error: "", busy: false, retry: undefined as Operation | undefined })
  const operation = () => state.retry ?? Schema.decodeUnknownOption(Operation)(props.metadata).valueOrUndefined
  const discovery = () => {
    const tab = task.current()
    return tab && tabs.skillDiscovery(tab)
  }
  const add = async () => {
    const installed = operation()?.result
    const tab = task.current()
    if (!installed || !tab || state.busy) return
    setState({ busy: true, error: "" })
    try {
      const items = (await sdk().client.v2.skill.installed({}, { throwOnError: true })).data.data
      const current = items.find((item) => item.id === installed.id && item.revision === installed.revision)
      if (!current) throw new Error(language.t("skills.unavailable"))
      if (!(await tabs.returnFromSkillDiscovery(tab, current))) {
        const target = task.target()
        if (target) tabs.addSkillToTask(target, current)
      }
    } catch (cause) {
      setState("error", message(cause))
    } finally {
      setState("busy", false)
    }
  }
  return (
    <div class="skill-tool-result" data-testid="skill-install-result">
      <strong>{operation()?.result?.name ?? language.t("skills.install")}</strong>
      <p role="status">
        {language.t(`skills.stage.${operation()?.stage ?? (props.status === "error" ? "failed" : "resolving")}`)}
      </p>
      <Show when={operation()?.stage === "completed"}>
        <ButtonV2
          variant="contrast"
          class="skill-button skill-primary"
          disabled={state.busy}
          onClick={() => void add()}
        >
          {language.t(discovery()?.origin ? "skills.returnAndAdd" : "skills.addToTask")}
        </ButtonV2>
      </Show>
      <Show when={operation()?.stage === "failed" || props.status === "error"}>
        <ButtonV2
          variant="neutral"
          class="skill-button"
          disabled={state.busy}
          onClick={async () => {
            setState({ busy: true, error: "" })
            try {
              const source = Schema.decodeUnknownSync(
                Schema.Struct({ type: Schema.Literal("preview"), previewId: Schema.String }),
              )(props.input.source)
              const response = await sdk().client.v2.skill.install({ source }, { throwOnError: true })
              setState("retry", Schema.decodeUnknownSync(Operation)(response.data.data))
            } catch (cause) {
              setState("error", message(cause))
            } finally {
              setState("busy", false)
            }
          }}
        >
          {language.t("skills.retry")}
        </ButtonV2>
      </Show>
      <Show when={operation()?.error || state.error}>
        <p role="alert">{state.error || operation()?.error?.message}</p>
      </Show>
      <ButtonV2 variant="ghost" class="skill-link" onClick={() => navigate("/skills")}>
        {language.t("skills.title")}
      </ButtonV2>
    </div>
  )
}
ToolRegistry.register({ name: "install_skill", render: SkillInstallResult })
