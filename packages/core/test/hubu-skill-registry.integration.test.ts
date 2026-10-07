import { expect, test } from "bun:test"
import { Effect } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { sql } from "drizzle-orm"
import path from "node:path"
import { copyFile, readFile, writeFile } from "node:fs/promises"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Global } from "../src/global"
import { DatabaseMigration } from "../src/database/migration"
import { migrations } from "../src/database/migration.gen"
import { SkillLibrary } from "../src/skill/library"
import { SkillRegistryServer } from "../src/skill/registry-server"
import { SkillSource } from "../src/skill/source"
import { tmpdir } from "./fixture/tmpdir"

test("HUBU registry prefix supports install, durable task selection and offline ZIP imports", async () => {
  await using temp = await tmpdir()
  const entries = [
    {
      path: "SKILL.md",
      bytes: new TextEncoder().encode(
        "---\nname: hubu-fixture\ndescription: HUBU fixture\n---\nOriginal instructions.",
      ),
      executable: false,
    },
    { path: "references/notes.txt", bytes: new TextEncoder().encode("Reference contents"), executable: false },
  ]
  const source = {
    sourceType: "github" as const,
    repository: "example/hubu-skills",
    path: "fixture",
    name: "hubu-fixture",
    description: "HUBU fixture",
  }
  const registry = SkillRegistryServer.create(path.join(temp.path, "registry"), [])
  const candidate = await registry.publish({
    identity: { ...source, id: SkillLibrary.identity(source) },
    entries,
    upstreamRevision: "a".repeat(40),
  })
  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (!url.pathname.startsWith("/hubu-skills/v1/")) return new Response("Wrong prefix", { status: 404 })
      url.pathname = url.pathname.slice("/hubu-skills".length)
      return registry.fetch(new Request(url.href, request))
    },
  })
  const database = path.join(temp.path, "hubu.db")
  const client = path.join(temp.path, "client")
  const settings = { registryUrl: `${server.url.origin}/hubu-skills/`, allowDirect: false }
  try {
    const reference = await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const library = SkillLibrary.make(db, client, settings)
        expect(yield* library.search("hubu-fixture")).toMatchObject([{ id: candidate.id, installed: false }])
        const inspected = yield* library.read({ type: "registry", id: candidate.id, revision: candidate.revision })
        if (inspected.type !== "preview") throw new Error("Expected preview")
        expect(inspected.preview.skillMarkdown).toContain("Original instructions.")
        const stages: string[] = []
        const operation = yield* library.install({ type: "preview", previewId: inspected.preview.previewId }, (event) =>
          Effect.sync(() => {
            stages.push(event.stage)
          }),
        )
        expect(stages).toEqual(["resolving", "validating", "installing", "refreshing", "completed"])
        expect(operation.stage).toBe("completed")
        expect(operation.result?.id).toBe(candidate.id)
        const reference = { skillId: candidate.id, revision: candidate.revision, contentHash: candidate.contentHash }
        expect(yield* library.pin("hubu-task", [reference])).toEqual([reference])
        expect(yield* library.search("hubu-fixture")).toMatchObject([{ id: candidate.id, installed: true }])
        return reference
      }).pipe(Effect.provide(Database.layerFromPath(database))),
    )
    expect(requests).toContain(`/hubu-skills/v1/artifacts/${candidate.artifactHash}.zip`)
    expect(requests.every((request) => request.startsWith("/hubu-skills/"))).toBe(true)
    await server.stop(true)

    const zip = path.join(temp.path, "local.zip")
    await writeFile(zip, await SkillSource.zip(entries))
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const library = SkillLibrary.make(db, client, settings)
        expect(yield* library.list()).toMatchObject([{ id: reference.skillId }])
        expect(yield* library.pin("hubu-task", [reference])).toEqual([reference])
        const loaded = yield* library.load(reference)
        expect(yield* Effect.promise(() => readFile(path.join(loaded.path, "references/notes.txt"), "utf8"))).toBe(
          "Reference contents",
        )
        expect((yield* Effect.result(library.search("hubu-fixture")))._tag).toBe("Failure")

        const offline = SkillLibrary.make(db, client)
        const failure = yield* offline.search("hubu-fixture").pipe(Effect.flip)
        expect(failure.message).toContain("not configured")
        const preview = yield* offline.read({ type: "local", path: zip })
        if (preview.type !== "preview") throw new Error("Expected local ZIP preview")
        const installed = yield* offline.install({ type: "preview", previewId: preview.preview.previewId })
        expect(installed.stage).toBe("completed")
        expect(installed.result).toBeDefined()
        expect(yield* offline.list()).toHaveLength(2)
        yield* offline.remove(reference.skillId)
        expect((yield* offline.load(reference)).revision.contentHash).toBe(reference.contentHash)
        yield* offline.remove(installed.result!.id)
        expect(yield* offline.list()).toEqual([])
      }).pipe(Effect.provide(Database.layerFromPath(database))),
    )
  } finally {
    await server.stop(true)
  }
}, 30_000)

test("assembled HUBU service reads only the HUBU registry and never adopts KCode fallback settings", async () => {
  await using temp = await tmpdir()
  const previous = ["BRAND", "HUBU_SKILL_REGISTRY_URL", "KCODE_SKILL_REGISTRY_URL", "KCODE_SKILL_DIRECT_FALLBACK"].map(
    (key) => [key, process.env[key]] as const,
  )
  const registry = SkillRegistryServer.create(path.join(temp.path, "registry"), [])
  const requests = { hubu: 0, kai: 0 }
  const hubu = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.hubu++
      return registry.fetch(request)
    },
  })
  const kai = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests.kai++
      return new Response("Unexpected KCode request", { status: 500 })
    },
  })
  try {
    process.env.BRAND = "hubu"
    process.env.KCODE_SKILL_REGISTRY_URL = kai.url.href
    process.env.KCODE_SKILL_DIRECT_FALLBACK = "1"
    for (const configured of [true, false]) {
      if (configured) process.env.HUBU_SKILL_REGISTRY_URL = hubu.url.href
      else delete process.env.HUBU_SKILL_REGISTRY_URL
      const layer = AppNodeBuilder.build(SkillLibrary.node, [
        [
          Global.node,
          Global.layerWith({
            data: temp.path,
            cache: path.join(temp.path, "cache"),
            config: path.join(temp.path, "config"),
          }),
        ],
        [Database.node, Database.layerFromPath(path.join(temp.path, "runtime.db"))],
      ])
      await Effect.runPromise(
        Effect.gen(function* () {
          const library = yield* SkillLibrary.Service
          if (configured) expect(yield* library.search("fixture")).toEqual([])
          else {
            expect((yield* library.search("fixture").pipe(Effect.flip)).message).toContain("not configured")
            expect(
              (yield* library
                .read({ type: "url", url: "https://github.com/fixture/skills/tree/main/example" })
                .pipe(Effect.flip)).message,
            ).toContain("not configured")
            expect(yield* library.list()).toEqual([])
          }
        }).pipe(Effect.provide(layer)),
      )
    }
    expect(requests).toEqual({ hubu: 1, kai: 0 })
  } finally {
    await hubu.stop(true)
    await kai.stop(true)
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}, 30_000)

test("HUBU skill upgrade preserves a copy of pre-skill projects, conversations and model settings", async () => {
  await using temp = await tmpdir()
  const original = path.join(temp.path, "hubu-2.1.4.db")
  const upgraded = path.join(temp.path, "hubu-2.1.11.db")
  const tables = ["project", "session", "message", "part"]
  const baseline = await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* DatabaseMigration.applyOnly(
        db,
        migrations.filter((migration) => migration.id < "20261004045527"),
      )
      yield* db.run(
        sql`INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes) VALUES ('proj_hubu_old', '/fixture/hubu', '旧项目', 1, 2, '[]')`,
      )
      yield* db.run(
        sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, model) VALUES ('ses_hubu_old', 'proj_hubu_old', 'old-chat', '/fixture/hubu', '旧会话', '2.1.4', 1, 2, '{"id":"existing-model","providerID":"campus"}')`,
      )
      yield* db.run(
        sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_hubu_old', 'ses_hubu_old', 1, 2, '{"role":"user","time":{"created":1}}')`,
      )
      yield* db.run(
        sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_hubu_old', 'msg_hubu_old', 'ses_hubu_old', 1, 2, '{"type":"text","text":"保留原来的对话"}')`,
      )
      expect(yield* db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'skill_%'`)).toEqual(
        [],
      )
      return yield* Effect.forEach(tables, (table) => db.all(sql`SELECT * FROM ${sql.identifier(table)}`))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: original, disableWAL: true })), Effect.scoped),
  )
  const bytes = await readFile(original)
  await copyFile(original, upgraded)
  for (const reopen of [false, true]) {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        expect(yield* Effect.forEach(tables, (table) => db.all(sql`SELECT * FROM ${sql.identifier(table)}`))).toEqual(
          baseline,
        )
        expect(
          yield* db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'skill_%' ORDER BY name`),
        ).toEqual([
          { name: "skill_identity" },
          { name: "skill_installation" },
          { name: "skill_operation" },
          { name: "skill_reference" },
          { name: "skill_revision" },
          { name: "skill_selection" },
        ])
        expect(
          yield* db.get(
            sql`SELECT count(*) AS count FROM migration WHERE id IN ('20261004045527_skill_library', '20261004045807_skill_selection')`,
          ),
        ).toEqual({ count: 2 })
        if (!reopen) yield* db.run(sql`INSERT INTO skill_selection (owner, refs) VALUES ('ses_hubu_old', '[]')`)
        expect(yield* db.get(sql`SELECT refs FROM skill_selection WHERE owner = 'ses_hubu_old'`)).toEqual({
          refs: "[]",
        })
      }).pipe(Effect.provide(Database.layerFromPath(upgraded))),
    )
  }
  expect(await readFile(original)).toEqual(bytes)
}, 30_000)
