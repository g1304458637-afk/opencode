import { expect, test } from "bun:test"
import { SkillRegistryServer } from "../src/skill/registry-server"
import { SkillSource } from "../src/skill/source"
import { tmpdir } from "./fixture/tmpdir"

const body = (url: string) => JSON.stringify({ url: `https://github.com/example/skills/${url}` })

test("registry coalesces and caches repeated GitHub discovery", async () => {
  const temp = await tmpdir()
  let requests = 0
  const candidate = {
    repository: "example/skills",
    path: "skills/design",
    upstreamRevision: "a".repeat(40),
    url: `https://github.com/example/skills/tree/${"a".repeat(40)}/skills/design`,
  }
  const registry = SkillRegistryServer.create(temp.path, undefined, {
    discover: async () => {
      requests++
      await Bun.sleep(10)
      return [candidate]
    },
    github: async () => {
      throw new Error("Unexpected GitHub resolution")
    },
  })

  try {
    const send = () =>
      registry.fetch(
        new Request("http://localhost/v1/discover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body(""),
        }),
      )
    const concurrent = await Promise.all([send(), send(), send()])
    expect(await Promise.all(concurrent.map((response) => response.json()))).toEqual([
      [candidate],
      [candidate],
      [candidate],
    ])
    expect(requests).toBe(1)
    expect((await send()).status).toBe(200)
    expect(requests).toBe(1)
  } finally {
    await temp[Symbol.asyncDispose]()
  }
})

test("registry returns Retry-After and stops calling GitHub during its rate-limit window", async () => {
  const temp = await tmpdir()
  let requests = 0
  const registry = SkillRegistryServer.create(temp.path, undefined, {
    discover: async () => {
      requests++
      throw new SkillSource.GitHubSourceError(403, true, 42)
    },
    github: async () => {
      throw new Error("Unexpected GitHub resolution")
    },
  })

  try {
    const send = () =>
      registry.fetch(
        new Request("http://localhost/v1/discover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: body(""),
        }),
      )
    const first = await send()
    expect(first.status).toBe(503)
    expect(first.headers.get("retry-after")).toBe("42")
    const second = await send()
    expect(second.status).toBe(503)
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0)
    expect(requests).toBe(1)
  } finally {
    await temp[Symbol.asyncDispose]()
  }
})
