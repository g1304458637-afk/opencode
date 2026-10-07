export type CampusDeleteSession = { id: string; parentID?: string; title: string; directory: string }

// Capture descendants by identity, never by directory: a moved chat keeps its original working directory.
export function campusDeleteTree(root: string, sessions: CampusDeleteSession[]) {
  const ids = new Set([root])
  for (;;) {
    const count = ids.size
    for (const session of sessions) {
      if (session.parentID && ids.has(session.parentID)) ids.add(session.id)
    }
    if (count === ids.size) return sessions.filter((session) => ids.has(session.id))
  }
}

export async function runCampusDelete(input: {
  roots: CampusDeleteSession[]
  confirmed: CampusDeleteSession[]
  current: CampusDeleteSession[]
  running: Set<string>
  remove: (session: CampusDeleteSession) => Promise<unknown>
  removed: (sessions: CampusDeleteSession[]) => void
}) {
  const allowed = new Set(input.confirmed.map((s) => s.id))
  const failed: { session: CampusDeleteSession; reason: "running" | "changed" | "request" }[] = []
  const succeeded: string[] = []
  for (const root of input.roots) {
    const tree = campusDeleteTree(root.id, input.current)
    if (tree.some((s) => !allowed.has(s.id))) {
      failed.push({ session: root, reason: "changed" })
      continue
    }
    if (tree.some((s) => input.running.has(s.id))) {
      failed.push({ session: root, reason: "running" })
      continue
    }
    const result =
      tree.length === 0 ||
      (await input.remove(root).then(
        () => true,
        () => false,
      ))
    if (!result) {
      failed.push({ session: root, reason: "request" })
      continue
    }
    input.removed(campusDeleteTree(root.id, input.confirmed))
    succeeded.push(root.id)
  }
  return { failed, succeeded }
}
