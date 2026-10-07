import { Effect, Schema } from "effect"
import { SkillLibrary } from "@opencode-ai/core/skill/library"
import { SkillManagementTools } from "@opencode-ai/core/tool/skill-management"
import { Tool } from "./tool"

export const SearchSkillsTool = Tool.define(
  "search_skills",
  Effect.gen(function* () {
    const library = yield* SkillLibrary.Service
    return {
      description: SkillManagementTools.searchDescription,
      parameters: SkillManagementTools.SearchInput,
      execute: (input: typeof SkillManagementTools.SearchInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "search_skills", patterns: [input.query], always: ["*"], metadata: {} })
          const candidates = yield* library.search(input.query).pipe(Effect.orDie)
          return { title: "Skill search", metadata: { candidates }, output: JSON.stringify({ candidates }) }
        }),
    }
  }),
)
export const ReadSkillTool = Tool.define(
  "read_skill",
  Effect.gen(function* () {
    const library = yield* SkillLibrary.Service
    return {
      description: SkillManagementTools.readDescription,
      parameters: SkillManagementTools.ReadInput,
      execute: (input: typeof SkillManagementTools.ReadInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "read_skill",
            patterns: [JSON.stringify(input.source)],
            always: ["*"],
            metadata: {},
          })
          const result = yield* library.read(input.source).pipe(Effect.orDie)
          return { title: "Skill preview", metadata: { ...result }, output: JSON.stringify(result) }
        }),
    }
  }),
)
export const InstallSkillTool = Tool.define(
  "install_skill",
  Effect.gen(function* () {
    const library = yield* SkillLibrary.Service
    return {
      description: SkillManagementTools.installDescription,
      parameters: SkillManagementTools.InstallInput,
      execute: (input: typeof SkillManagementTools.InstallInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "install_skill",
            patterns: [JSON.stringify(input.source)],
            always: ["*"],
            metadata: {},
          })
          const result = yield* library.install(input.source, (operation) =>
            ctx.metadata({ metadata: { ...operation } }),
          )
          if (result.stage === "failed")
            return yield* Effect.die(new Error(`${result.error?.stage}: ${result.error?.message}`))
          return {
            title: result.result?.name ?? "Skill installation",
            metadata: { ...result },
            output: JSON.stringify(result),
          }
        }),
    }
  }),
)
export const ListInstalledSkillsTool = Tool.define(
  "list_installed_skills",
  Effect.gen(function* () {
    const library = yield* SkillLibrary.Service
    return {
      description: "List local installed skill metadata without loading instructions.",
      parameters: Schema.Struct({}),
      execute: (_: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "list_installed_skills", patterns: ["*"], always: ["*"], metadata: {} })
          const skills = yield* library.list()
          return { title: "Installed skills", metadata: { skills }, output: JSON.stringify({ skills }) }
        }),
    }
  }),
)
export const RemoveSkillTool = Tool.define(
  "remove_skill",
  Effect.gen(function* () {
    const library = yield* SkillLibrary.Service
    return {
      description: "Remove the Installation the user explicitly requested. Referenced task revisions are retained.",
      parameters: SkillManagementTools.RemoveInput,
      execute: (input: typeof SkillManagementTools.RemoveInput.Type, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({ permission: "remove_skill", patterns: [input.id], always: [input.id], metadata: {} })
          yield* library.remove(input.id).pipe(Effect.orDie)
          return {
            title: "Skill removed",
            metadata: { id: input.id, removed: true },
            output: JSON.stringify({ removed: true, id: input.id }),
          }
        }),
    }
  }),
)
