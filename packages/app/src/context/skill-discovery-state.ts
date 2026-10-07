import type { Selectable } from "@opencode-ai/schema/skill-library"
import type { Tab } from "./tabs"

export type SkillTaskTarget = { tab: Tab; directory: string }
export type SkillDiscoveryState = {
  discoveries: Record<string, { origin?: SkillTaskTarget }>
  pending: Record<string, Selectable[]>
}

export function promoteSkillDiscovery(state: SkillDiscoveryState, previous: string, next: Tab, key: string) {
  const discoveries = Object.fromEntries(
    Object.entries(state.discoveries).map(([id, value]) => [
      id === previous ? key : id,
      value.origin?.tab.type === "draft" && `draft:${value.origin.tab.draftID}` === previous
        ? { ...value, origin: { ...value.origin, tab: next } }
        : value,
    ]),
  )
  const pending = Object.fromEntries(
    Object.entries(state.pending).map(([id, value]) => [id === previous ? key : id, value]),
  )
  return { discoveries, pending }
}
