import type { Session } from "@opencode-ai/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

export type CampusProject = { directory: string; name: string }

export function campusProjectFor(
  session: Pick<Session, "id" | "directory">,
  projects: CampusProject[],
  assigned: Record<string, string | null>,
) {
  if (Object.hasOwn(assigned, session.id)) return assigned[session.id] ?? undefined
  const directory = pathKey(session.directory)
  return projects
    .filter((project) => {
      const root = pathKey(project.directory)
      return directory === root || directory.startsWith(`${root}/`)
    })
    .sort((a, b) => b.directory.length - a.directory.length)[0]?.directory
}
