import { resolveBrand } from "@opencode-ai/brand"
import { Icon } from "@opencode-ai/ui/icon"
import { useNavigate } from "@solidjs/router"
import { For } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useSettingsDialog } from "@/components/settings-dialog"
import mucCrest from "@/assets/muc/crest.png"
import hubuCrest from "@/assets/hubu/crest.png"

const brand = resolveBrand()
const crests: Record<string, string> = { muc: mucCrest, hubu: hubuCrest }

export function WorkspaceSidebar() {
  const language = useLanguage()
  const command = useCommand()
  const layout = useLayout()
  const server = useServer()
  const navigate = useNavigate()
  const settings = useSettingsDialog()
  const pick = useDirectoryPicker()
  const projects = () => {
    const current = server.current
    if (!current) return
    pick({
      server: current,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (value) => {
        if (!value) return
        for (const path of Array.isArray(value) ? value : [value]) layout.projects.open(path)
        navigate("/")
      },
    })
  }
  const items = () => [
    {
      id: "sessions",
      icon: "bubble-5" as const,
      label: language.t("home.sessions.search.sessions"),
      action: () => navigate("/"),
      active: layout.route().type !== "draft",
    },
    {
      id: "new",
      icon: "plus" as const,
      label: language.t("command.session.new"),
      action: () => command.trigger("tab.new"),
      active: layout.route().type === "draft",
    },
    {
      id: "projects",
      icon: "folder" as const,
      label: language.t("command.project.open"),
      action: projects,
      active: false,
    },
    {
      id: "commands",
      icon: "console" as const,
      label: language.t("command.palette"),
      action: () => command.show(),
      active: false,
    },
  ]
  return (
    <aside class="campus-sidebar" data-brand={brand.id}>
      <button class="campus-sidebar__brand" onClick={() => navigate("/")} aria-label={language.t("home.title")}>
        <span class="campus-sidebar__crest">
          <img src={crests[brand.id]} alt="" />
        </span>
        <span class="campus-sidebar__name">{brand.workspaceName}</span>
      </button>
      <nav aria-label={language.t("home.title")}>
        <For each={items()}>
          {(item) => (
            <button
              data-campus-nav={item.id}
              aria-label={item.label}
              title={item.label}
              aria-current={item.active ? "page" : undefined}
              onClick={item.action}
            >
              <Icon name={item.icon} size="normal" />
              <span>{item.label}</span>
            </button>
          )}
        </For>
        <div class="campus-sidebar__divider" />
        <button
          data-campus-nav="settings"
          onClick={settings}
          aria-label={language.t("command.settings.open")}
          title={language.t("command.settings.open")}
        >
          <Icon name="settings-gear" size="normal" />
          <span>{language.t("command.category.settings")}</span>
        </button>
      </nav>
    </aside>
  )
}
