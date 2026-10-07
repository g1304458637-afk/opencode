import path from "node:path"
import { randomUUID } from "node:crypto"
import { Effect, Schema } from "effect"
import { SkillLibrary } from "@opencode-ai/schema/skill-library"
import { array, check, object } from "./assertions"
import { request } from "./backend"
import type { Method, ScenarioContext } from "./types"

export * as SkillFixture from "./skill-fixture"

export async function create(directory: string) {
  const { SkillRegistryServer } = await import("@opencode-ai/core/skill/registry-server")
  const { SkillSource } = await import("@opencode-ai/core/skill/source")
  const { identity } = await import("@opencode-ai/core/skill/library")
  const markdown = `---\nname: httpapi-skill\ndescription: HTTP API fixture\n---\nOriginal instructions ${randomUUID()}.\nRun \`echo skill-fixture\`.`
  const entries = [
    { path: "SKILL.md", bytes: new TextEncoder().encode(markdown), executable: false },
    { path: "references/example.txt", bytes: new TextEncoder().encode("Original resource"), executable: false },
  ]
  const source = {
    sourceType: "github" as const,
    repository: "fixture/httpapi",
    path: "example",
    name: "httpapi-skill",
    description: "HTTP API fixture",
  }
  const registry = SkillRegistryServer.create(path.join(directory, "registry"), [])
  const candidate = await registry.publish({
    identity: { ...source, id: identity(source) },
    entries,
    upstreamRevision: "a".repeat(40),
  })
  const archive = path.join(directory, "skill.zip")
  await Bun.write(archive, await SkillSource.zip(entries))
  await Bun.write(path.join(directory, "home", ".keep"), "")
  const hits: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      hits.push(url.pathname)
      if (!url.pathname.startsWith("/hubu-skills/")) return new Response("Invalid registry prefix", { status: 404 })
      url.pathname = url.pathname.slice("/hubu-skills".length)
      return registry.fetch(new Request(url.href, request))
    },
  })
  const previous = new Map(
    ["BRAND", "HUBU_API_KEY", "HUBU_SKILL_REGISTRY_URL", "OPENCODE_TEST_HOME", "OPENCODE_DISABLE_EXTERNAL_SKILLS"].map(
      (key) => [key, process.env[key]],
    ),
  )
  process.env.OPENCODE_TEST_HOME = path.join(directory, "home")
  process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "true"
  process.env.BRAND = "hubu"
  delete process.env.HUBU_API_KEY
  process.env.HUBU_SKILL_REGISTRY_URL = `${server.url.origin}/hubu-skills/`
  return {
    archive,
    candidate,
    markdown,
    hits,
    async dispose() {
      try {
        await server.stop(true)
      } finally {
        for (const [key, value] of previous) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    },
  }
}

export type Info = Awaited<ReturnType<typeof create>>

export function fixture(ctx: ScenarioContext) {
  if (!ctx.skills) throw new Error("Scenario requires the isolated skill fixture")
  return ctx.skills
}

export const api = <A>(ctx: ScenarioContext, method: Method, path: string, schema: Schema.Decoder<A>, body?: unknown) =>
  request(method, { path, headers: ctx.headers(), body }).pipe(
    Effect.map((result) => {
      check(result.status === 200, `Expected skill API 200, received ${result.status}: ${result.text}`)
      object(result.body)
      object(result.body.location)
      return Schema.decodeUnknownSync(schema)(result.body.data)
    }),
  )

export const preview = (ctx: ScenarioContext, local = false) =>
  api(ctx, "POST", "/api/skill/read", SkillLibrary.ReadResult, {
    source: local
      ? { type: "local", path: fixture(ctx).archive }
      : { type: "registry", id: fixture(ctx).candidate.id, revision: fixture(ctx).candidate.revision },
  }).pipe(
    Effect.map((result) => {
      if (result.type !== "preview") throw new Error("Expected an immutable skill preview")
      check(result.preview.skillMarkdown === fixture(ctx).markdown, "Preview must preserve original instructions")
      return result.preview
    }),
  )

export const install = (ctx: ScenarioContext) =>
  preview(ctx).pipe(
    Effect.flatMap((preview) =>
      api(ctx, "POST", "/api/skill/install", SkillLibrary.Operation, {
        id: `fixture-${randomUUID()}`,
        source: { type: "preview", previewId: preview.previewId },
      }).pipe(
        Effect.map((operation) => {
          check(operation.stage === "completed", "Fixture installation must complete")
          if (!operation.result) throw new Error("Completed install did not return a skill")
          return { operation, installed: operation.result, preview }
        }),
      ),
    ),
  )

export function contentSource(preview: SkillLibrary.Preview) {
  return { type: "preview" as const, previewId: preview.previewId }
}

export function installedBody(body: unknown, id: string) {
  object(body)
  object(body.location)
  array(body.data)
  check(
    body.data.some((item) => typeof item === "object" && item !== null && "id" in item && item.id === id),
    "Installed skill missing from response",
  )
}
