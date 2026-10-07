import { SkillLibrary } from "@opencode-ai/core/skill/library"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillSelection } from "@opencode-ai/core/skill/selection"
import path from "path"
import { Effect, Schema } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const library = yield* SkillLibrary.Service
    const skill = yield* Skill.Service
    const ripgrep = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (SkillSelection.required()) {
            yield* ctx.ask({
              permission: "skill",
              patterns: [params.name],
              always: [params.name],
              metadata: {},
            })
            const task = ctx.messages.findLast((message) => message.info.role === "user")?.info
            const selected = yield* Effect.forEach(task?.role === "user" ? (task.selectedSkills ?? []) : [], (ref) =>
              SkillV2.loadRevision(library, ref),
            ).pipe(Effect.orDie)
            const matches = selected.filter((info) => info.name === params.name)
            if (matches.length !== 1)
              return yield* Effect.die(new Error("Skill must be explicitly selected and unambiguous"))
            const dir = path.dirname(matches[0].location)
            return {
              title: params.name,
              metadata: { name: params.name, dir },
              output: `Selected skill ${params.name} is already loaded for this task. Resources: ${dir}`,
            }
          }
          const info = yield* skill
            .require(params.name)
            .pipe(Effect.catchTag("Skill.NotFoundError", (error) => Effect.die(new Error(error.message))))

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          const dir = path.dirname(info.location)
          const base = dir
          const files = yield* ripgrep.find({
            cwd: dir,
            pattern: "!**/SKILL.md",
            hidden: true,
            follow: false,
            signal: ctx.abort,
            limit: 10,
          })

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files.map((file) => `<file>${path.resolve(dir, file.path)}</file>`).join("\n"),
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
