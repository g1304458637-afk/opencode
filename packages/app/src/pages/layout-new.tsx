import { createEffect, onCleanup, onMount, Show, Suspense, type ParentProps } from "solid-js"
import { resolveBrand } from "@opencode-ai/brand"
import { useLayout } from "@/context/layout"
import { WorkspaceSidebar } from "@/components/campus/workspace-sidebar"
import { NewSessionBackground } from "./new-session/new-session-background"
import "@/components/campus/workspace-tokens.css"
import "@/components/campus/workspace-shell.css"
import "@/components/campus/workspace-content.css"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const layout = useLayout()
  const brand = resolveBrand()
  const [state, setState] = createStore({ debugTools: false })

  onMount(() => {
    if (!brand.campus) return
    document.body.dataset.campusWorkspace = brand.id
    onCleanup(() => delete document.body.dataset.campusWorkspace)
  })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      data-component={brand.campus ? "campus-workspace" : undefined}
      data-view={layout.route().type}
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Show when={brand.campus}>
        <NewSessionBackground workspace />
      </Show>
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <div class="campus-workspace__body flex flex-1 min-h-0 min-w-0">
        <Show when={brand.campus}>
          <WorkspaceSidebar />
        </Show>
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
