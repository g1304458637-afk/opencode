import { expect, test } from "bun:test"
import { campusDeleteTree, runCampusDelete, type CampusDeleteSession } from "./campus-delete"

const root = { id: "a", title: "A", directory: "/original" }
const child = { id: "b", parentID: "a", title: "B", directory: "/original/sub" }
const other = { id: "c", title: "C", directory: "/original" }

test("deletion descendants follow parent IDs, not shared directories", () => {
  expect(campusDeleteTree("a", [child, other, root]).map((s) => s.id)).toEqual(["b", "a"])
})

test("running children and new descendants block deletion before requests", async () => {
  const deleted: string[] = []
  const run = (confirmed: CampusDeleteSession[], running: Set<string>) =>
    runCampusDelete({
      roots: [root],
      confirmed,
      current: [root, child],
      running,
      remove: async (s) => {
        deleted.push(s.id)
      },
      removed: () => {},
    })
  expect((await run([root], new Set())).failed[0].reason).toBe("changed")
  expect((await run([root, child], new Set([child.id]))).failed[0].reason).toBe("running")
  expect(deleted).toEqual([])
})

test("partial failures retry only remaining roots, retaining original directory", async () => {
  const calls: string[] = []
  const removed: string[] = []
  const input = {
    roots: [root, other],
    confirmed: [root, child, other],
    current: [root, child, other],
    running: new Set<string>(),
    remove: async (s: CampusDeleteSession) => {
      calls.push(s.id)
      expect(s.directory).toBe("/original")
      if (s.id === "c" && calls.filter((id) => id === "c").length === 1) throw new Error("offline")
    },
    removed: (sessions: CampusDeleteSession[]) => {
      removed.push(...sessions.map((s) => s.id))
    },
  }
  const first = await runCampusDelete(input)
  expect(first.succeeded).toEqual(["a"])
  const second = await runCampusDelete({ ...input, roots: first.failed.map((f) => f.session), current: [other] })
  expect(second.failed).toEqual([])
  expect(calls).toEqual(["a", "c", "c"])
  expect(removed).toEqual(["a", "b", "c"])
})

test("already absent sessions clean up locally without repeating DELETE", async () => {
  const calls: string[] = []
  const result = await runCampusDelete({
    roots: [root],
    confirmed: [root],
    current: [],
    running: new Set(),
    remove: async () => {
      throw new Error("must not request")
    },
    removed: (sessions) => {
      calls.push(...sessions.map((s) => s.id))
    },
  })
  expect(result.succeeded).toEqual(["a"])
  expect(calls).toEqual(["a"])
})
