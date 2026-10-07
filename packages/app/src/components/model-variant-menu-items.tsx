import { For, Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useLanguage } from "@/context/language"

export function ModelVariantMenuItems(props: {
  options: string[]
  current: string
  active?: string
  onActive?: (value: string) => void
  onSelect: (value: string) => void
}) {
  const language = useLanguage()
  return (
    <Show when={props.options.length > 0}>
      <div class="h-px bg-v2-border-border-muted" />
      <MenuV2.Group class="p-0.5">
        <MenuV2.GroupLabel>{language.t("ui.promptInput.chooseVariant")}</MenuV2.GroupLabel>
        <MenuV2.RadioGroup value={props.current}>
          <For each={props.options}>
            {(value) => (
              <MenuV2.RadioItem
                value={value}
                data-option-key={`variant:${value}`}
                classList={{ "!bg-v2-overlay-simple-overlay-hover": props.active === `variant:${value}` }}
                onMouseEnter={() => props.onActive?.(value)}
                onSelect={() => props.onSelect(value)}
              >
                {value === "default" ? language.t("common.default") : value}
              </MenuV2.RadioItem>
            )}
          </For>
        </MenuV2.RadioGroup>
      </MenuV2.Group>
    </Show>
  )
}
