import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { InstallSource } from "@opencode-ai/schema/skill-library"
import { mkdtemp, mkdir, writeFile, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Database } from "../src/database/database"
import { SkillLibrary } from "../src/skill/library"
import { SkillArchive } from "../src/skill/archive"

const entries = (text = "Original instructions") => [
  {
    path: "SKILL.md",
    bytes: new TextEncoder().encode(`---\nname: example\ndescription: Example skill\n---\n${text}`),
    executable: false,
  },
  { path: "resources/reference.txt", bytes: new TextEncoder().encode("resource, not prompt text"), executable: false },
]
const source = (repository = "example") => {
  const data = { sourceType: "local" as const, repository, path: "", name: "example", description: "Example skill" }
  return { ...data, id: SkillLibrary.identity(data) }
}
const ref = (installed: { id: string; revision: string; contentHash: string }) => ({
  skillId: installed.id,
  revision: installed.revision,
  contentHash: installed.contentHash,
})

async function fixture(
  run: (library: SkillLibrary.Interface, root: string, db: Database.Interface["db"]) => Effect.Effect<unknown, unknown>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "kcode-skill-test-"))
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* run(SkillLibrary.make(db, root), root, db)
      }).pipe(Effect.provide(Database.layerFromPath(path.join(root, "test.db")))),
    )
  } finally {
    Bun.gc(true)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

test("content-addressed revisions deduplicate imports, identities and task submissions", () =>
  fixture((library, root) =>
    Effect.gen(function* () {
      const first = yield* library.importEntries(source(), entries())
      const second = yield* library.importEntries(source("another source"), entries())
      expect(first.id).not.toBe(second.id)
      expect(first.revision).toBe(second.revision)
      yield* library.pin("task-a", [ref(first)])
      yield* library.pin("task-b", [ref(first), ref(second)])
      yield* library.pin("task-a", [ref(first)])
      expect(yield* Effect.promise(() => readdir(path.join(root, "objects")))).toEqual([first.contentHash])
      expect(yield* library.list()).toHaveLength(2)
    }),
  ))

test("remove only uninstalls; locked revisions survive reinstall and new service instance", () =>
  fixture((library, root, db) =>
    Effect.gen(function* () {
      const old = yield* library.importEntries(source(), entries())
      yield* library.pin("old-task", [ref(old)])
      const next = yield* library.importEntries(source(), entries("Updated instructions"))
      expect(next.revision).not.toBe(old.revision)
      yield* library.pin("new-task", [ref(next)])
      yield* library.remove(old.id)
      expect(yield* library.list()).toEqual([])
      const reopened = SkillLibrary.make(db, root)
      expect((yield* reopened.load(ref(old))).revision.revision).toBe(old.revision)
      expect((yield* reopened.load(ref(next))).revision.revision).toBe(next.revision)
      yield* reopened.pin("old-task", [ref(old)])
      expect((yield* Effect.result(reopened.pin("another-task", [ref(old)])))._tag).toBe("Failure")
      yield* library.remove(old.id)
    }),
  ))

test("empty selection is immutable and unavailable revisions fail rather than upgrade", () =>
  fixture((library) =>
    Effect.gen(function* () {
      const installed = yield* library.importEntries(source(), entries())
      yield* library.pin("empty-task", [])
      expect((yield* Effect.result(library.pin("empty-task", [ref(installed)])))._tag).toBe("Failure")
      expect((yield* Effect.result(library.load({ ...ref(installed), contentHash: "0".repeat(64) })))._tag).toBe(
        "Failure",
      )
    }),
  ))

test("immutable preview handles can be reread and reject changed contents", () =>
  fixture((library, root) =>
    Effect.gen(function* () {
      const folder = path.join(root, "source")
      yield* Effect.promise(() => mkdir(folder))
      yield* Effect.promise(() => writeFile(path.join(folder, "SKILL.md"), entries()[0].bytes))
      const inspected = yield* library.read({ type: "local", path: folder })
      if (inspected.type !== "preview") throw new Error("Expected preview")
      expect(yield* library.preview(inspected.preview.previewId)).toEqual(inspected.preview)
      yield* Effect.promise(() =>
        writeFile(
          path.join(root, "previews", `${inspected.preview.previewId}.json`),
          JSON.stringify({ ...inspected.preview, skillMarkdown: "changed" }),
        ),
      )
      expect((yield* Effect.result(library.preview(inspected.preview.previewId)))._tag).toBe("Failure")
    }),
  ))

test("real folder import reports durable stages and is immediately listed", () =>
  fixture((library, root) =>
    Effect.gen(function* () {
      const folder = path.join(root, "source")
      yield* Effect.promise(async () => {
        await mkdir(folder)
        await writeFile(path.join(folder, "SKILL.md"), entries()[0].bytes)
      })
      const stages: string[] = []
      const inspected = yield* library.read({ type: "local", path: folder })
      if (inspected.type !== "preview") throw new Error("Expected preview")
      const operation = yield* library.install({ type: "preview", previewId: inspected.preview.previewId }, (event) =>
        Effect.sync(() => {
          stages.push(event.stage)
        }),
      )
      expect(stages).toEqual(["resolving", "validating", "installing", "refreshing", "completed"])
      expect(operation.result?.name).toBe("example")
      expect((yield* library.operation(operation.id))?.stage).toBe("completed")
      expect(yield* library.list()).toHaveLength(1)
      expect(yield* Effect.promise(() => readdir(path.join(root, "staging")))).toEqual([])
    }),
  ))

test("missing markdown and linked files fail without installing", () =>
  fixture((library, root) =>
    Effect.gen(function* () {
      const folder = path.join(root, "source")
      yield* Effect.promise(() => mkdir(folder))
      expect((yield* Effect.result(library.read({ type: "local", path: folder })))._tag).toBe("Failure")
      yield* Effect.promise(() => symlink(path.join(root, "test.db"), path.join(folder, "SKILL.md")))
      expect((yield* Effect.result(library.read({ type: "local", path: folder })))._tag).toBe("Failure")
      expect(yield* library.list()).toEqual([])
    }),
  ))

test("unsafe and colliding paths are rejected before publication", () => {
  for (const name of ["../escape", "/absolute", "C:\\escape", "a/../b", "a//b", "CON", "file:stream", "trailing."])
    expect(() =>
      SkillArchive.validate([...entries(), { path: name, bytes: new Uint8Array(), executable: false }]),
    ).toThrow()
  expect(() =>
    SkillArchive.validate([...entries(), { path: "skill.md", bytes: new Uint8Array(), executable: false }]),
  ).toThrow()
  expect(() =>
    SkillArchive.validate([...entries(), { path: "resources", bytes: new Uint8Array(), executable: false }]),
  ).toThrow()
})

for (const prefix of ["", "/hubu-skills"])
  test(`Registry ${prefix || "/"} installs independently of client GitHub; duplicate reuse and failed downloads`, () =>
    fixture((_, root, db) =>
      Effect.gen(function* () {
        const { SkillRegistryServer } = yield* Effect.promise(() => import("../src/skill/registry-server"))
        const registry = SkillRegistryServer.create(path.join(root, "registry"), [])
        const candidate = yield* Effect.promise(() =>
          registry.publish({ identity: source("registry"), entries: entries(), upstreamRevision: "fixed-upstream" }),
        )
        let mode = "normal"
        let downloads = 0
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          error() {
            return new Response("connection interrupted", { status: 502 })
          },
          fetch(request) {
            const url = new URL(request.url)
            if (!url.pathname.startsWith(`${prefix}/v1/`)) return new Response("Wrong Registry prefix", { status: 404 })
            url.pathname = url.pathname.slice(prefix.length)
            if (request.url.includes("/artifacts/")) {
              downloads++
              if (mode === "corrupt") return new Response("corrupt")
              if (mode === "interrupt")
                return new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(new Uint8Array([1]))
                      controller.close()
                    },
                  }),
                  { headers: { "content-length": "1024" } },
                )
            }
            if (request.method === "POST") return Response.json(candidate)
            return registry.fetch(new Request(url.href))
          },
        })
        try {
          const library = SkillLibrary.make(db, path.join(root, "client"), {
            registryUrl: `${server.url.origin}${prefix}`,
          })
          expect(yield* library.search("example")).toHaveLength(1)
          const inspected = yield* library.read({ type: "registry", id: candidate.id, revision: candidate.revision })
          if (inspected.type !== "preview") throw new Error("Expected preview")
          const first = yield* library.install({ type: "preview", previewId: inspected.preview.previewId })
          expect(first.stage).toBe("completed")
          expect((yield* library.load(ref(first.result!))).revision.upstreamRevision).toBe("fixed-upstream")
          const preview = yield* library.read({ type: "registry", id: candidate.id, revision: candidate.revision })
          if (preview.type !== "preview") throw new Error("Expected preview")
          const duplicate = yield* library.install({ type: "preview", previewId: preview.preview.previewId })
          expect(duplicate.alreadyInstalled).toBe(true)
          expect(downloads).toBe(2)
          expect((yield* library.search("example"))[0].installed).toBe(true)
          yield* library.remove(candidate.id)
          for (const failure of ["corrupt", "interrupt"]) {
            mode = failure
            const offline = yield* library.install({ type: "preview", previewId: preview.preview.previewId })
            expect(offline.stage).toBe("completed")
            yield* library.remove(candidate.id)
            expect(
              (yield* Effect.result(library.read({ type: "registry", id: candidate.id, revision: candidate.revision })))
                ._tag,
            ).toBe("Failure")
            expect(yield* library.list()).toEqual([])
            expect(yield* Effect.promise(() => readdir(path.join(root, "client", "staging")))).toEqual([])
          }
        } finally {
          yield* Effect.promise(async () => {
            await server.stop(true)
          })
        }
      }),
    ))

test("ZIP import preserves resources without executing scripts", () =>
  fixture((library, root) =>
    Effect.gen(function* () {
      const { zip } = yield* Effect.promise(() => import("../src/skill/source"))
      const file = path.join(root, "skill.zip")
      yield* Effect.promise(async () =>
        writeFile(
          file,
          await zip([
            ...entries(),
            { path: "install.sh", bytes: new TextEncoder().encode("exit 99"), executable: true },
          ]),
        ),
      )
      const inspected = yield* library.read({ type: "local", path: file })
      if (inspected.type !== "preview") throw new Error("Expected preview")
      const installed = yield* library.install({ type: "preview", previewId: inspected.preview.previewId })
      expect(installed.error).toBeUndefined()
      expect(installed.stage).toBe("completed")
      expect((yield* library.load(ref(installed.result!))).revision.files.map((item) => item.path)).toEqual([
        "SKILL.md",
        "install.sh",
        "resources/reference.txt",
      ])
    }),
  ))

test("locked loader injects selected SKILL.md only, preserving old revision", () =>
  fixture((library) =>
    Effect.gen(function* () {
      const { context } = yield* Effect.promise(() => import("../src/skill/selection"))
      const first = yield* library.importEntries(source(), entries("FIRST_INSTRUCTIONS"))
      const second = yield* library.importEntries(source("second"), entries("SECOND_INSTRUCTIONS"))
      yield* library.importEntries(source("unselected"), entries("UNSELECTED_SECRET"))
      yield* library.pin("submitted", [ref(first), ref(second)])
      yield* library.importEntries(source(), entries("UPGRADED_INSTRUCTIONS"))
      yield* library.remove(first.id)
      expect(yield* context(library, [])).toEqual([])
      const output = (yield* context(library, [ref(first), ref(second)])).join("\n")
      expect(output).toContain("FIRST_INSTRUCTIONS")
      expect(output).toContain("SECOND_INSTRUCTIONS")
      expect(output).not.toContain("UPGRADED_INSTRUCTIONS")
      expect(output).not.toContain("UNSELECTED_SECRET")
      expect(output).not.toContain("resource, not prompt text")
      expect((yield* Effect.exit(context(library, [ref(first)], () => false)))._tag).toBe("Failure")
    }),
  ))

test("concurrent imports reuse one object and restore can retain a removed task revision", () =>
  fixture((library, root) =>
    Effect.gen(function* () {
      const installed = yield* Effect.all(
        [library.importEntries(source(), entries()), library.importEntries(source(), entries())],
        { concurrency: 2 },
      )
      expect(installed[0].revision).toBe(installed[1].revision)
      expect(yield* Effect.promise(() => readdir(path.join(root, "objects")))).toHaveLength(1)
      yield* library.pin("original", [ref(installed[0])])
      yield* library.remove(installed[0].id)
      yield* library.pin("restored", [ref(installed[0])], "original")
      expect((yield* Effect.result(library.pin("wrong", [], "original")))._tag).toBe("Failure")
    }),
  ))

test("malformed ZIP paths and symlink modes are rejected", async () => {
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = await import("@zip.js/zip.js")
  for (const [name, mode] of [
    ["../escape", 0o100644],
    ["link", 0o120777],
  ] as const) {
    const writer = new ZipWriter(new Uint8ArrayWriter())
    await writer.add(name, new Uint8ArrayReader(new TextEncoder().encode("outside")), {
      useWebWorkers: false,
      msDosCompatible: false,
      externalFileAttributes: mode << 16,
    })
    await expect(SkillArchive.unzip(await writer.close())).rejects.toThrow()
  }
})

test("Registry advertises current revision while old artifacts remain addressable", () =>
  fixture((_, root) =>
    Effect.gen(function* () {
      const { SkillRegistryServer } = yield* Effect.promise(() => import("../src/skill/registry-server"))
      const registry = SkillRegistryServer.create(path.join(root, "registry"), [])
      const old = yield* Effect.promise(() => registry.publish({ identity: source(), entries: entries("old") }))
      const current = yield* Effect.promise(() => registry.publish({ identity: source(), entries: entries("new") }))
      const found = yield* Effect.promise(async () =>
        (await registry.fetch(new Request("http://localhost/v1/skills?q=example"))).json(),
      )
      expect(found).toEqual([current])
      const retained = yield* Effect.promise(async () =>
        (await registry.fetch(new Request(`http://localhost/v1/skills/${old.id}/revisions/${old.revision}`))).json(),
      )
      expect(retained).toEqual(old)
    }),
  ))

test("preview pins bytes across edits and restart without installing or copying per task", () =>
  fixture((library, root, db) =>
    Effect.gen(function* () {
      const folder = path.join(root, "source")
      yield* Effect.promise(async () => {
        await mkdir(folder)
        await writeFile(path.join(folder, "SKILL.md"), entries()[0].bytes)
      })
      const first = yield* library.read({ type: "local", path: folder })
      if (first.type !== "preview") throw new Error("Expected preview")
      expect(yield* library.read({ type: "local", path: folder })).toEqual(first)
      expect(yield* library.list()).toEqual([])
      yield* Effect.promise(() => writeFile(path.join(folder, "SKILL.md"), entries("CHANGED")[0].bytes))
      const second = yield* library.read({ type: "local", path: folder })
      if (second.type !== "preview") throw new Error("Expected preview")
      expect(second.preview.previewId).not.toBe(first.preview.previewId)
      const reopened = SkillLibrary.make(db, root)
      const installed = yield* reopened.install({ type: "preview", previewId: first.preview.previewId })
      expect(installed.stage).toBe("completed")
      expect(installed.result?.revision).toBe(first.preview.revision)
      expect((yield* reopened.install({ type: "preview", previewId: first.preview.previewId })).alreadyInstalled).toBe(
        true,
      )
      yield* reopened.pin("origin-task", [ref(installed.result!)])
      yield* reopened.remove(first.preview.id)
      expect((yield* reopened.load(ref(installed.result!))).revision.revision).toBe(first.preview.revision)
      expect((yield* reopened.install({ type: "preview", previewId: "0".repeat(64) })).stage).toBe("failed")
      expect(
        Schema.decodeUnknownOption(InstallSource)({ type: "url", url: "https://github.com/example/repo" })
          .valueOrUndefined,
      ).toBeUndefined()
      expect(yield* Effect.promise(() => readdir(path.join(root, "objects")))).toHaveLength(2)
    }),
  ))

test("ambiguous repository returns pinned candidate paths without guessing or installing", () =>
  fixture((_, root, db) =>
    Effect.gen(function* () {
      const candidates = ["skills/a", "skills/b"].map((directory) => ({
        repository: "example/repo",
        path: directory,
        upstreamRevision: "a".repeat(40),
        url: `https://github.com/example/repo/tree/${"a".repeat(40)}/${directory}`,
      }))
      const library = SkillLibrary.make(db, root, {
        registry: {
          discover: async () => candidates,
          search: async () => [],
          resolve: async () => {
            throw new Error("Must not resolve an ambiguous root")
          },
          revision: async () => {
            throw new Error("Must not guess")
          },
        },
      })
      expect(yield* library.read({ type: "url", url: "https://github.com/example/repo" })).toEqual({
        type: "candidates",
        candidates,
      })
      expect(yield* library.list()).toEqual([])
    }),
  ))

test("reading a renamed revision does not change installed or locked revision metadata", () =>
  fixture((library, root) =>
    Effect.gen(function* () {
      const old = yield* library.importEntries(source(), entries())
      yield* library.pin("old-name-task", [ref(old)])
      const renamed = entries().map((entry) =>
        entry.path === "SKILL.md"
          ? {
              ...entry,
              bytes: new TextEncoder().encode(
                new TextDecoder().decode(entry.bytes).replace("name: example", "name: renamed"),
              ),
            }
          : entry,
      )
      yield* library.importEntries({ ...source(), name: "renamed" }, renamed, false)
      expect((yield* library.list())[0].name).toBe("example")
      expect((yield* library.load(ref(old))).identity.name).toBe("example")
      expect(yield* Effect.promise(() => readdir(path.join(root, "objects")))).toHaveLength(2)
    }),
  ))
