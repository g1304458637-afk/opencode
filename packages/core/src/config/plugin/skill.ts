export * as ConfigSkillPlugin from "./skill"

import { define } from "../../plugin/internal"
import path from "path"
import { Effect, Config } from "effect"
import { resolveBrand } from "@opencode-ai/brand"
import { Service } from "../../config"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"
import { Global } from "../../global"
import { Location } from "../../location"

export const Plugin = define({
  id: "config-skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const disableExternal = yield* Config.boolean("OPENCODE_DISABLE_EXTERNAL_SKILLS").pipe(
      Config.withDefault(false),
      Effect.orDie,
    )
    const disableClaude = yield* Config.boolean("OPENCODE_DISABLE_CLAUDE_CODE").pipe(
      Config.withDefault(false),
      Effect.orDie,
    )
    const disableClaudeSkills = yield* Config.boolean("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS").pipe(
      Config.withDefault(false),
      Effect.orDie,
    )
    yield* ctx.skill.transform(
      Effect.fn(function* (draft) {
        const entries = yield* config.entries()
        const directories = entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : []))
        const items = entries.flatMap((entry) => (entry.type === "document" ? (entry.info.skills ?? []) : []))
        if (!disableExternal && ["hubu", "kai"].includes(resolveBrand().id)) {
          const roots = new Set([global.home])
          let current: string = location.directory
          while (true) {
            roots.add(current)
            const parent = path.dirname(current)
            if (parent === current) break
            current = parent
          }
          for (const root of roots)
            for (const external of disableClaude || disableClaudeSkills ? [".agents"] : [".agents", ".claude"]) {
              draft.source(
                SkillV2.DirectorySource.make({
                  type: "directory",
                  path: AbsolutePath.make(path.join(root, external, "skills")),
                }),
              )
            }
        }
        for (const directory of directories) {
          draft.source(
            SkillV2.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skill")) }),
          )
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(path.join(directory, "skills")),
            }),
          )
        }
        for (const item of items) {
          if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
            draft.source(SkillV2.UrlSource.make({ type: "url", url: item }))
            continue
          }
          const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
          draft.source(
            SkillV2.DirectorySource.make({
              type: "directory",
              path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
            }),
          )
        }
      }),
    )
  }),
})
