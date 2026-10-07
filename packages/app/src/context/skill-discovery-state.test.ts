import { expect, test } from "bun:test"
import { promoteSkillDiscovery, type SkillDiscoveryState } from "./skill-discovery-state"
import type { Tab } from "./tabs"
import type { ServerConnection } from "./server"

const server = "local" as ServerConnection.Key
const original: Tab = { type: "draft", draftID: "original", server, directory: "/project" }
const session: Tab = { type: "session", sessionId: "session", server }

test("discovery origin follows the original task when its draft is promoted", () => {
  const state: SkillDiscoveryState = {
    discoveries: { "draft:finder": { origin: { tab: original, directory: "/project" } } },
    pending: { "draft:original": [] },
  }
  const updated = promoteSkillDiscovery(state, "draft:original", session, "session-key")
  expect(updated.discoveries["draft:finder"].origin?.tab).toEqual(session)
  expect(updated.pending["draft:original"]).toBeUndefined()
  expect(updated.pending["session-key"]).toEqual([])
  expect(state.discoveries["draft:finder"].origin?.tab).toEqual(original)
})

test("discovery promotion and serialization preserve the origin reference", () => {
  const state: SkillDiscoveryState = {
    discoveries: { "draft:finder": { origin: { tab: original, directory: "/project" } } },
    pending: {},
  }
  const updated = promoteSkillDiscovery(state, "draft:finder", session, "finder-session")
  const restored: SkillDiscoveryState = JSON.parse(JSON.stringify(updated))
  expect(restored.discoveries["draft:finder"]).toBeUndefined()
  expect(restored.discoveries["finder-session"].origin).toEqual({ tab: original, directory: "/project" })
})
