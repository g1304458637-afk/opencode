import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Global } from "../src/global"
import { Database } from "../src/database/database"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { Catalog } from "../src/catalog"
import { ModelV2 } from "../src/model"
import { ProviderV2 } from "../src/provider"
import { SkillV2 } from "../src/skill"
import { SkillLibrary } from "../src/skill/library"
import { SkillSelection } from "../src/skill/selection"
import { SkillTranslation } from "../src/skill/translation"

// Exercise the production layer graph and actual HTTP model adapter. In particular,
// the returned service must work without an ambient LLMClient in the caller's context.
test("assembled translation service resolves every source, preserves originals, caches and retries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kcode-translation-service-"))
  const previousBrand = process.env.BRAND
  process.env.BRAND = "hubu"
  let requests = 0
  let requestedModel = ""
  let invalid = false
  let untranslated = false
  let emptyDescription = false
  const gateway = Bun.serve({
    port: 0,
    async fetch(request) {
      requests++
      const body = Schema.decodeUnknownSync(
        Schema.Struct({
          model: Schema.String,
          tools: Schema.optional(Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) }))),
        }),
      )(await request.json())
      requestedModel = body.model
      const argumentsJson = invalid
        ? "{}"
        : JSON.stringify({
            ...(untranslated
              ? {
                  name: "English skill",
                  description: "An English description",
                  skillMarkdown: "# English instructions",
                }
              : {
                  name: "中文技能",
                  description: emptyDescription ? "" : "用于验证的中文简介",
                  skillMarkdown: "# 中文说明\n保留 `npm run build` 命令。",
                }),
          })
      const base = { id: "translation-test", object: "chat.completion.chunk", created: 1, model: body.model }
      const chunks = (body.tools ?? []).length
        ? [
            {
              ...base,
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_translation",
                        type: "function",
                        function: { name: body.tools![0].function.name, arguments: argumentsJson },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              ...base,
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            },
          ]
        : [
            {
              ...base,
              choices: [{ index: 0, delta: { role: "assistant", content: argumentsJson }, finish_reason: null }],
            },
            {
              ...base,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
            },
          ]
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  const layer = AppNodeBuilder.build(
    LayerNode.group([SkillTranslation.node, SkillV2.node, SkillLibrary.node, Catalog.node]),
    [
      [
        Global.node,
        Global.layerWith({ data: root, cache: path.join(root, "cache"), config: path.join(root, "config") }),
      ],
      [Database.node, Database.layerFromPath(path.join(root, "test.db"))],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make(root) })],
    ],
  )
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const providerID = ProviderV2.ID.make("sub2api")
        const modelID = ModelV2.ID.make("translation-model")
        yield* catalog.transform((editor) => {
          editor.provider.update(providerID, (provider) => {
            provider.api = {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: `http://127.0.0.1:${gateway.port}/v1`,
            }
            provider.request.body.apiKey = "fixture"
          })
          editor.model.update(providerID, modelID, (model) => {
            model.enabled = true
            model.capabilities.tools = true
          })
          editor.provider.update(ProviderV2.ID.make("opencode"), (provider) => {
            provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "http://127.0.0.1:1/v1" }
          })
          editor.model.update(ProviderV2.ID.make("opencode"), ModelV2.ID.make("unrelated-free-model"), (model) => {
            model.enabled = true
          })
          editor.model.default.set(ProviderV2.ID.make("opencode"), ModelV2.ID.make("unrelated-free-model"))
        })
        const skills = yield* SkillV2.Service
        const file = path.join(root, "project-skill", "SKILL.md")
        const original =
          "---\nname: project-skill\ndescription: Project description\n---\n# Original instructions\nRun `npm run build`."
        yield* Effect.promise(async () => {
          await mkdir(path.dirname(file))
          await writeFile(file, original)
        })
        yield* skills.transform((editor) => {
          editor.source({ type: "directory", path: AbsolutePath.make(path.dirname(file)) })
          editor.source({
            type: "embedded",
            skill: {
              name: "builtin-skill",
              description: "Builtin description",
              location: AbsolutePath.make("/builtin/skill"),
              content: "# Builtin original",
            },
          })
        })
        const library = yield* SkillLibrary.Service
        const identity = {
          sourceType: "local" as const,
          repository: "test",
          path: "SKILL.md",
          name: "project-skill",
          description: "Project description",
        }
        const installed = yield* library.importEntries({ ...identity, id: SkillLibrary.identity(identity) }, [
          { path: "SKILL.md", bytes: new TextEncoder().encode(original), executable: false },
        ])
        const reference = { skillId: installed.id, revision: installed.revision, contentHash: installed.contentHash }
        const translator = yield* SkillTranslation.Service
        const sources = [
          { type: "revision" as const, reference },
          ...(yield* skills.list()).map((skill) => {
            const item = SkillSelection.source(skill)
            return { type: "discovered" as const, id: item.id, contentHash: item.contentHash }
          }),
        ]
        expect(sources).toHaveLength(3)
        for (const source of sources) {
          const before = yield* translator.content(source)
          const output = yield* Effect.promise(() =>
            Effect.runPromise(translator.translate({ source, includeMarkdown: false })),
          )
          expect(output.name).toBe("中文技能")
          expect(yield* translator.content(source)).toEqual(before)
        }
        const count = requests
        yield* translator.translate({ source: sources[0], includeMarkdown: false })
        expect(requests).toBe(count)
        const full = yield* translator.translate({
          source: sources[0],
          includeMarkdown: true,
          model: { providerID, modelID },
        })
        expect(full.skillMarkdown).toContain("中文说明")
        expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe(original)
        expect(yield* SkillSelection.context(library, [reference])).toEqual([
          expect.stringContaining("Original instructions"),
        ])
        const builtin = sources.find(
          (source) =>
            source.type === "discovered" &&
            source.id ===
              SkillSelection.source({
                name: "builtin-skill",
                description: "Builtin description",
                location: "/builtin/skill",
                content: "# Builtin original",
              }).id,
        )!
        const badHash = { ...builtin, contentHash: "f".repeat(64) }
        expect(yield* translator.content(badHash).pipe(Effect.flip)).toMatchObject({ code: "HASH_MISMATCH" })
        // A failed model response must not poison a future successful attempt.
        invalid = true
        const failure = yield* translator.translate({ source: builtin, includeMarkdown: true }).pipe(Effect.flip)
        expect(failure.code).toBe("TRANSLATION_FAILED")
        invalid = false
        expect((yield* translator.translate({ source: builtin, includeMarkdown: true })).skillMarkdown).toContain(
          "中文说明",
        )
        expect(
          yield* translator
            .translate({ source: sources[1], includeMarkdown: true, model: { providerID, modelID: "missing" } })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "MODEL_UNAVAILABLE" })
        const previous = SkillSelection.source((yield* skills.list()).find((item) => item.name === "project-skill")!)
        yield* Effect.promise(() => writeFile(file, original.replace("Original instructions", "Updated instructions")))
        yield* skills.reload()
        const updated = SkillSelection.source((yield* skills.list()).find((item) => item.name === "project-skill")!)
        expect(updated.id).toBe(previous.id)
        expect(updated.contentHash).not.toBe(previous.contentHash)
        expect(
          yield* translator
            .content({ type: "discovered", id: previous.id, contentHash: previous.contentHash })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "HASH_MISMATCH" })
        const beforeUpdate = requests
        yield* translator.translate({
          source: { type: "discovered", id: updated.id, contentHash: updated.contentHash },
          includeMarkdown: false,
        })
        expect(requests).toBe(beforeUpdate + 1)
        yield* Effect.promise(() =>
          writeFile(file, original.replace("Original instructions", "Final English instructions")),
        )
        yield* skills.reload()
        const final = SkillSelection.source((yield* skills.list()).find((item) => item.name === "project-skill")!)
        untranslated = true
        const untranslatedFailure = yield* translator
          .translate({
            source: { type: "discovered", id: final.id, contentHash: final.contentHash },
            includeMarkdown: false,
          })
          .pipe(Effect.flip)
        expect(untranslatedFailure.code).toBe("TRANSLATION_FAILED")
        untranslated = false
        yield* catalog.transform((editor) =>
          editor.model.update(providerID, modelID, (model) => {
            model.enabled = false
          }),
        )
        const beforeUnavailable = requests
        expect(
          yield* translator
            .translate({
              source: { type: "discovered", id: final.id, contentHash: final.contentHash },
              includeMarkdown: true,
            })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "MODEL_UNAVAILABLE" })
        expect(requests).toBe(beforeUnavailable)
        // Chat translation respects an explicitly selected configured provider;
        // only the global library's omitted model is restricted to the HUBU gateway.
        yield* catalog.transform((editor) => {
          editor.provider.update(ProviderV2.ID.make("configured-chat"), (provider) => {
            provider.api = {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: `http://127.0.0.1:${gateway.port}/v1`,
            }
            provider.request.body.apiKey = "fixture"
          })
          editor.model.update(ProviderV2.ID.make("configured-chat"), ModelV2.ID.make("chat-model"), (model) => {
            model.enabled = true
          })
        })
        expect(
          yield* translator
            .translate({
              source: { type: "discovered", id: final.id, contentHash: final.contentHash },
              includeMarkdown: true,
              model: { providerID: "configured-chat", modelID: "missing" },
            })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "MODEL_UNAVAILABLE" })
        expect(requests).toBe(beforeUnavailable)
        expect(
          (yield* translator.translate({
            source: { type: "discovered", id: final.id, contentHash: final.contentHash },
            includeMarkdown: true,
            model: { providerID: "configured-chat", modelID: "chat-model" },
          })).skillMarkdown,
        ).toContain("中文说明")
        expect(requests).toBe(beforeUnavailable + 1)
        expect(requestedModel).toBe("chat-model")
        const emptyIdentity = {
          ...identity,
          repository: "empty-description",
          name: "without-description",
          description: "",
        }
        const emptyOriginal = "---\nname: without-description\n---\n# Instructions without a description"
        const emptySkill = yield* library.importEntries(
          { ...emptyIdentity, id: SkillLibrary.identity(emptyIdentity) },
          [{ path: "SKILL.md", bytes: new TextEncoder().encode(emptyOriginal), executable: false }],
        )
        const emptyRequest = {
          source: {
            type: "revision" as const,
            reference: { skillId: emptySkill.id, revision: emptySkill.revision, contentHash: emptySkill.contentHash },
          },
          includeMarkdown: true,
          model: { providerID: "configured-chat", modelID: "chat-model" },
        }
        const beforeEmpty = requests
        emptyDescription = true
        const emptyResult = yield* translator.translate(emptyRequest)
        expect(emptyResult).toMatchObject({ name: "中文技能", description: "" })
        expect((yield* translator.content(emptyRequest.source)).skillMarkdown).toBe(emptyOriginal)
        expect(requests).toBe(beforeEmpty + 1)
        expect(yield* translator.translate(emptyRequest)).toEqual(emptyResult)
        expect(requests).toBe(beforeEmpty + 1)
      }).pipe(Effect.provide(layer), Effect.scoped),
    )
  } finally {
    if (previousBrand === undefined) delete process.env.BRAND
    else process.env.BRAND = previousBrand
    gateway.stop(true)
    Bun.gc(true)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 30000)
