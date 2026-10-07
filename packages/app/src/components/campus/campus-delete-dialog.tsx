import { Root, Portal, Overlay } from "@kobalte/core/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createStore } from "solid-js/store"
import { For, onMount, Show } from "solid-js"
import { useCampusProjects } from "@/context/campus-projects"
import { useLanguage } from "@/context/language"
import type { CampusDeleteSession } from "./campus-delete"

export type CampusDeleteRequest = {
  mode: "session" | "remove" | "project"
  name: string
  directory?: string
  sessions: CampusDeleteSession[]
}

export function CampusDeleteDialog(props: { request: CampusDeleteRequest; onClose: () => void }) {
  const projects = useCampusProjects()
  const language = useLanguage()
  const prepareDelete = projects.captureDeletion()
  const request = props.request
  const removeProject = projects.projectRemoval(request.directory ?? "")
  const [state, setState] = createStore({
    loading: request.mode !== "remove",
    busy: false,
    pending: request.sessions,
    confirmed: request.sessions,
    succeeded: 0,
    scopeRoots: request.sessions.length,
    attempted: false,
    error: "" as "" | "load" | "request",
    failed: [] as { session: CampusDeleteSession; reason: "running" | "changed" | "request" }[],
    transaction: undefined as Awaited<ReturnType<typeof projects.prepareDelete>> | undefined,
  })
  const prepare = async () => {
    setState({ loading: true, error: "" })
    await prepareDelete(state.pending).then(
      (transaction) =>
        setState({
          transaction,
          confirmed: transaction.confirmed,
          failed: [],
          attempted: false,
          scopeRoots: state.pending.length,
        }),
      () => setState("error", "load"),
    )
    setState("loading", false)
  }
  onMount(() => {
    if (request.mode !== "remove") void prepare()
  })
  const close = () => {
    if (!state.busy) props.onClose()
  }
  const submit = async () => {
    if (state.busy || projects.busy() || state.loading || state.error === "load") return
    if (request.mode === "remove") {
      removeProject()
      props.onClose()
      return
    }
    const transaction = state.transaction
    if (!transaction) return
    setState({ busy: true, error: "" })
    await transaction.execute(state.pending).then(
      (result) => {
        setState({
          attempted: true,
          succeeded: state.succeeded + result.succeeded.length,
          failed: result.failed,
          pending: result.failed.map((item) => item.session),
        })
        if (result.failed.length) return
        if (request.mode === "project") transaction.hideProject(request.directory!)
        props.onClose()
      },
      () => setState("error", "request"),
    )
    setState("busy", false)
  }
  const title = () =>
    language.t(
      request.mode === "session"
        ? "session.delete.title"
        : request.mode === "remove"
          ? "campus.delete.remove"
          : "campus.delete.project",
    )
  return (
    <Root
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <Portal>
        <Overlay data-component="dialog-overlay" />
        <div>
          <Dialog
            title={title()}
            fit
            class="campus-delete-dialog"
            action={
              <ButtonV2 variant="ghost" disabled={state.busy} onClick={close}>
                {language.t("common.cancel")}
              </ButtonV2>
            }
          >
            <div class="campus-delete-body" aria-busy={state.busy || state.loading}>
              <p>
                {language.t(
                  request.mode === "remove" ? "campus.delete.removeDescription" : "campus.delete.description",
                  {
                    name: request.name,
                  },
                )}
              </p>
              <Show when={request.mode !== "remove"}>
                <p>{language.t("campus.delete.count", { roots: state.scopeRoots, total: state.confirmed.length })}</p>
                <ul class="campus-delete-list" aria-label={language.t("campus.delete.scope")}>
                  <For each={state.confirmed}>
                    {(session) => (
                      <li>
                        {session.title}
                        <small>{session.directory}</small>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={state.loading}>
                <p role="status">{language.t("common.loading")}</p>
              </Show>
              <Show when={state.error}>
                <p role="alert">{language.t("campus.delete.error")}</p>
              </Show>
              <Show when={state.attempted && state.failed.length}>
                <p role="status">
                  {language.t("campus.delete.partial", { success: state.succeeded, failed: state.failed.length })}
                </p>
                <ul class="campus-delete-errors">
                  <For each={state.failed}>
                    {(item) => (
                      <li>
                        {item.session.title}：{language.t(`campus.delete.${item.reason}`)}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <div class="campus-delete-actions">
                <Show
                  when={state.error === "load" || state.failed.some((item) => item.reason === "changed")}
                  fallback={
                    <ButtonV2
                      variant="danger"
                      class="campus-delete-danger"
                      disabled={state.busy || state.loading || projects.busy()}
                      onClick={() => void submit()}
                    >
                      {language.t(
                        state.busy
                          ? "campus.delete.working"
                          : state.attempted
                            ? "campus.delete.retry"
                            : request.mode === "remove"
                              ? "campus.delete.remove"
                              : "session.delete.button",
                      )}
                    </ButtonV2>
                  }
                >
                  <ButtonV2 disabled={state.busy || state.loading} onClick={() => void prepare()}>
                    {language.t("campus.delete.reload")}
                  </ButtonV2>
                </Show>
              </div>
            </div>
          </Dialog>
        </div>
      </Portal>
    </Root>
  )
}
