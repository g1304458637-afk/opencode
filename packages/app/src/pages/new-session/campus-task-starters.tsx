import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { For } from "solid-js"
import { createStore } from "solid-js/store"
import type { PromptInputV2ComposerController } from "@/components/prompt-input-v2"
import { useLanguage } from "@/context/language"

const starters = [
  { id: "website", icon: "window-cursor" },
  { id: "code", icon: "code" },
  { id: "read", icon: "open-file" },
  { id: "write", icon: "pencil-line" },
  { id: "data", icon: "bullet-list" },
  { id: "video", icon: "photo" },
] as const

export function CampusTaskStarters(props: { input: PromptInputV2ComposerController }) {
  const language = useLanguage()
  const [state, setState] = createStore({ inserted: false })
  const insert = (id: (typeof starters)[number]["id"]) => {
    const text = props.input
      .parts()
      .map((part) => ("content" in part ? part.content : ""))
      .join("")
    // Append at the end through the existing editor store, preserving mentions, images and context.
    props.input.dispatch({ type: "mode.normal" })
    props.input.dispatch({ type: "popover.close" })
    props.input.onCursor(text.length)
    const content = `${text.trim() ? "\n\n" : ""}${language.t(`campus.start.${id}.prompt`)}`
    props.input.addPart({ type: "text", content, start: 0, end: content.length })
    setState("inserted", true)
    props.input.restoreFocus()
  }
  return (
    <section class="campus-task-starters" aria-labelledby="campus-task-starters-title">
      <h2 id="campus-task-starters-title">{language.t("campus.start.examples")}</h2>
      <div class="campus-task-starters__grid">
        <For each={starters}>
          {(starter) => (
            <ButtonV2 variant="neutral" type="button" data-task-starter={starter.id} onClick={() => insert(starter.id)}>
              <Icon name={starter.icon} size="large" />
              <span>
                <strong>{language.t(`campus.start.${starter.id}.title`)}</strong>
                <span>{language.t(`campus.start.${starter.id}.description`)}</span>
              </span>
            </ButtonV2>
          )}
        </For>
      </div>
      <p role="status" aria-live="polite">
        {language.t(
          state.inserted && props.input.parts().some((part) => part.type === "text" && part.content.trim())
            ? "campus.start.inserted"
            : "campus.start.hint",
        )}
      </p>
    </section>
  )
}
