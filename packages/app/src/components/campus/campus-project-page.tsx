import { useLanguage } from "@/context/language"
import { CampusRecentTasks } from "./campus-recent-tasks"

export function CampusProjectPage() {
  const language = useLanguage()
  return (
    <div data-component="campus-home" data-testid="campus-projects" class="campus-feature-page">
      <div class="campus-feature-content">
        <h1>{language.t("sidebar.nav.projectsAndSessions")}</h1>
        <CampusRecentTasks />
      </div>
    </div>
  )
}
