import { randomUUID } from "node:crypto"
import { Effect, Schema } from "effect"
import { SkillLibrary } from "@opencode-ai/schema/skill-library"
import { check, object, stable } from "./assertions"
import { http, route } from "./dsl"
import { SkillFixture } from "./skill-fixture"
import type { Scenario } from "./types"

export const skillScenarios: Scenario[] = [
  http.protected
    .get("/api/skill/library", "v2.skill.installed")
    .withSkills()
    .seeded(SkillFixture.install)
    .json(200, (body, ctx) => {
      SkillFixture.installedBody(body, ctx.state.installed.id)
      object(body)
      const installed = Schema.decodeUnknownSync(Schema.Array(SkillLibrary.Installed))(body.data)
      check(
        installed.some(
          (item) => item.id === ctx.state.installed.id && item.contentHash === ctx.state.installed.contentHash,
        ),
        "Installed listing must retain revision metadata",
      )
    }),
  http.protected
    .get("/api/skill/available", "v2.skill.available")
    .withSkills()
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* ctx.file(
          ".opencode/skills/project-fixture/SKILL.md",
          "---\nname: project-fixture\ndescription: Project skill\n---\nProject instructions",
        )
        return yield* SkillFixture.install(ctx)
      }),
    )
    .json(200, (body, ctx) => {
      SkillFixture.installedBody(body, ctx.state.installed.id)
      object(body)
      const items = Schema.decodeUnknownSync(Schema.Array(SkillLibrary.Selectable))(body.data)
      check(
        items.some((item) => item.name === "project-fixture" && !item.managed),
        "Available listing must discover the temporary project skill",
      )
    }),
  http.protected
    .get("/api/skill/search", "v2.skill.search")
    .withSkills()
    .at((ctx) => ({ path: "/api/skill/search?q=httpapi-skill", headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.location)
      const candidates = Schema.decodeUnknownSync(Schema.Array(SkillLibrary.Candidate))(body.data)
      const fixture = SkillFixture.fixture(ctx)
      check(
        candidates.some((item) => item.id === fixture.candidate.id && item.revision === fixture.candidate.revision),
        "Search must return the actual local registry candidate",
      )
      check(fixture.hits.includes("/hubu-skills/v1/skills"), "Search must reach the isolated registry")
    }),
  http.protected
    .post("/api/skill/read", "v2.skill.read")
    .withSkills()
    .at((ctx) => ({
      path: "/api/skill/read",
      headers: ctx.headers(),
      body: { source: { type: "local", path: SkillFixture.fixture(ctx).archive } },
    }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.location)
      const result = Schema.decodeUnknownSync(SkillLibrary.ReadResult)(body.data)
      check(result.type === "preview", "Local ZIP must return a preview")
      check(
        result.preview.skillMarkdown === SkillFixture.fixture(ctx).markdown,
        "Preview must retain original ZIP contents",
      )
      check(result.preview.contentHash === result.preview.revision, "Preview must lock a content-addressed revision")
    }),
  http.protected
    .post("/api/skill/content", "v2.skill.content")
    .withSkills()
    .seeded((ctx) => SkillFixture.preview(ctx))
    .at((ctx) => ({
      path: "/api/skill/content",
      headers: ctx.headers(),
      body: { source: SkillFixture.contentSource(ctx.state) },
    }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.location)
      const content = Schema.decodeUnknownSync(SkillLibrary.Content)(body.data)
      check(content.skillMarkdown === SkillFixture.fixture(ctx).markdown, "Content must return original instructions")
      check(content.contentHash === ctx.state.contentHash, "Content must refer to the preview's exact revision")
    }),
  http.protected
    .post("/api/skill/translate", "v2.skill.translate")
    .withSkills()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const preview = yield* SkillFixture.preview(ctx)
        yield* ctx.llmText(
          JSON.stringify({
            name: "接口测试技能",
            description: "用于验证技能翻译",
            skillMarkdown: "# 中文说明\n运行 `echo skill-fixture`。",
          }),
        )
        return preview
      }),
    )
    .at((ctx) => ({
      path: "/api/skill/translate",
      headers: ctx.headers(),
      body: {
        source: SkillFixture.contentSource(ctx.state),
        includeMarkdown: true,
        model: { providerID: "test", modelID: "test-model" },
      },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        object(body.location)
        const translated = Schema.decodeUnknownSync(SkillLibrary.Translation)(body.data)
        check(
          translated.name === "接口测试技能" && translated.description === "用于验证技能翻译",
          "Translation must use the local model response",
        )
        check(
          translated.skillMarkdown?.includes("echo skill-fixture") === true,
          "Translated details must preserve commands",
        )
        yield* ctx.llmWait(1)
        const original = yield* SkillFixture.api(ctx, "POST", "/api/skill/content", SkillLibrary.Content, {
          source: SkillFixture.contentSource(ctx.state),
        })
        check(
          original.skillMarkdown === SkillFixture.fixture(ctx).markdown,
          "Translation must not alter executable original content",
        )
      }),
    ),
  http.protected
    .post("/api/skill/install", "v2.skill.install")
    .withSkills()
    .mutating()
    .seeded((ctx) => SkillFixture.preview(ctx))
    .at((ctx) => ({
      path: "/api/skill/install",
      headers: ctx.headers(),
      body: { id: `install-${ctx.state.previewId}`, source: { type: "preview", previewId: ctx.state.previewId } },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        object(body.location)
        const operation = Schema.decodeUnknownSync(SkillLibrary.Operation)(body.data)
        check(
          operation.stage === "completed" && operation.result?.id === ctx.state.id,
          "Installation must finish successfully",
        )
        const installed = yield* SkillFixture.api(
          ctx,
          "GET",
          "/api/skill/library",
          Schema.Array(SkillLibrary.Installed),
        )
        check(
          installed.some((item) => item.id === ctx.state.id && item.revision === ctx.state.revision),
          "Install must persist the inspected revision",
        )
        const saved = yield* SkillFixture.api(
          ctx,
          "GET",
          route("/api/skill/operation/{id}", { id: operation.id }),
          SkillLibrary.Operation,
        )
        check(
          saved.stage === "completed" && saved.result?.contentHash === ctx.state.contentHash,
          "Install operation must be durably readable",
        )
      }),
    ),
  http.protected
    .get("/api/skill/operation/{id}", "v2.skill.operation")
    .withSkills()
    .seeded(SkillFixture.install)
    .at((ctx) => ({ path: route("/api/skill/operation/{id}", { id: ctx.state.operation.id }), headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.location)
      const operation = Schema.decodeUnknownSync(SkillLibrary.Operation)(body.data)
      check(
        operation.id === ctx.state.operation.id && operation.stage === "completed",
        "Operation route must load the persisted installation",
      )
      check(
        operation.result?.contentHash === ctx.state.installed.contentHash,
        "Operation must retain exact installed content",
      )
    }),
  http.protected
    .delete("/api/skill/library/{id}", "v2.skill.remove")
    .withSkills()
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const state = yield* SkillFixture.install(ctx)
        const owner = `remove-${randomUUID()}`
        const refs = yield* SkillFixture.api(
          ctx,
          "POST",
          "/api/skill/selection",
          Schema.Array(SkillLibrary.Reference),
          { owner, skills: [{ id: state.installed.id, revision: state.installed.revision }] },
        )
        return { ...state, owner, refs }
      }),
    )
    .at((ctx) => ({ path: route("/api/skill/library/{id}", { id: ctx.state.installed.id }), headers: ctx.headers() }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        check(body.data === true, "Remove should report completion")
        const installed = yield* SkillFixture.api(
          ctx,
          "GET",
          "/api/skill/library",
          Schema.Array(SkillLibrary.Installed),
        )
        check(
          !installed.some((item) => item.id === ctx.state.installed.id),
          "Remove must delete the installation record",
        )
        const locked = yield* SkillFixture.api(ctx, "POST", "/api/skill/content", SkillLibrary.Content, {
          source: { type: "revision", reference: ctx.state.refs[0] },
        })
        check(
          locked.skillMarkdown === SkillFixture.fixture(ctx).markdown,
          "Uninstall must retain task-pinned original content",
        )
        check(
          yield* Effect.promise(() => Bun.file(SkillFixture.fixture(ctx).archive).exists()),
          "Uninstall must not delete local source files",
        )
      }),
    ),
  http.protected
    .post("/api/skill/selection", "v2.skill.prepare")
    .withSkills()
    .mutating()
    .seeded((ctx) =>
      SkillFixture.install(ctx).pipe(Effect.map((state) => ({ ...state, owner: `prepare-${randomUUID()}` }))),
    )
    .at((ctx) => ({
      path: "/api/skill/selection",
      headers: ctx.headers(),
      body: {
        owner: ctx.state.owner,
        skills: [{ id: ctx.state.installed.id, revision: ctx.state.installed.revision }],
      },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        object(body)
        object(body.location)
        const refs = Schema.decodeUnknownSync(Schema.Array(SkillLibrary.Reference))(body.data)
        check(
          refs.length === 1 &&
            refs[0].skillId === ctx.state.installed.id &&
            refs[0].revision === ctx.state.installed.revision &&
            refs[0].contentHash === ctx.state.installed.contentHash,
          "Prepare must lock the selected revision",
        )
        yield* SkillFixture.api(
          ctx,
          "DELETE",
          route("/api/skill/library/{id}", { id: ctx.state.installed.id }),
          Schema.Boolean,
        )
        const restored = yield* SkillFixture.api(
          ctx,
          "POST",
          "/api/skill/selection",
          Schema.Array(SkillLibrary.Reference),
          {
            owner: `${ctx.state.owner}-restored`,
            restoreFrom: ctx.state.owner,
            skills: [{ id: ctx.state.installed.id, revision: ctx.state.installed.revision }],
          },
        )
        check(
          stable(restored) === stable(refs),
          "Prepare must durably pin the owner and restore the exact removed revision",
        )
      }),
    ),
]
