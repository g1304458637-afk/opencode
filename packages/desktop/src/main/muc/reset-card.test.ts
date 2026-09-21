import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ResetCardClient } from "./reset-card"

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))
function directory() {
  const path = mkdtempSync(join(tmpdir(), "campus-reset-test-"))
  directories.push(path)
  return path
}

test("concurrent clicks, lost response, restart and acknowledgement use one durable operation", async () => {
  const path = directory()
  const requests: string[] = []
  let attempts = 0
  const request: typeof fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Headers(init?.headers).get("Idempotency-Key")!)
    // Inspect the real journal before the network boundary; no plaintext credential is persisted.
    const journal = readFileSync(join(path, readdirSync(path)[0]!), "utf8")
    expect(journal).toContain(requests.at(-1)!)
    expect(journal).not.toContain("secret-key")
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (++attempts === 1) throw new Error("server committed, response lost")
    return Response.json({ data: { weekly_period_ends_at: "2099-01-01T00:00:00Z" } })
  }, { preconnect: fetch.preconnect })
  const client = new ResetCardClient(path, "/v1/muc/reset-with-card", request)
  const first = await Promise.all(Array.from({ length: 20 }, () => client.reset("http://localhost", "secret-key", 1)))
  expect(first.every((r) => !r.ok)).toBe(true)
  expect(requests).toHaveLength(1)
  const restarted = new ResetCardClient(path, "/v1/muc/reset-with-card", request)
  const result = await restarted.reset("http://localhost", "secret-key", 1)
  expect(result.ok).toBe(true)
  expect(requests[0]).toBe(requests[1])
  await restarted.reset("http://localhost", "secret-key", 1)
  expect(requests).toHaveLength(2)
  if (!result.ok) throw new Error("reset failed")
  restarted.acknowledge("http://localhost", "secret-key", 1, "wrong-operation")
  expect(readdirSync(path)).toHaveLength(1)
  restarted.acknowledge("http://localhost", "secret-key", 1, result.operationId)
  await restarted.reset("http://localhost", "secret-key", 1)
  expect(requests[2]).not.toBe(requests[0])
})

test("expired uncertainty and corrupted journal fail closed instead of spending another card", async () => {
  const path = directory()
  let calls = 0
  const request: typeof fetch = Object.assign(async () => { calls++; throw new Error("offline") }, { preconnect: fetch.preconnect })
  const client = new ResetCardClient(path, "/reset", request)
  await client.reset("http://localhost", "key", 1)
  const file = join(path, readdirSync(path)[0]!)
  const original = JSON.parse(readFileSync(file, "utf8"))
  writeFileSync(file, JSON.stringify({ ...original, createdAt: Date.now() - 24 * 3600_000 }))
  expect(await client.reset("http://localhost", "key", 1)).toEqual({ ok: false, error: "reconciliation_required" })
  writeFileSync(file, "corrupt")
  expect((await client.reset("http://localhost", "key", 1)).ok).toBe(false)
  expect(calls).toBe(1)
})
