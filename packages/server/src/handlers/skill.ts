import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillLibrary } from "@opencode-ai/core/skill/library"
import { SkillTranslation } from "@opencode-ai/core/skill/translation"
import { SkillSelection } from "@opencode-ai/core/skill/selection"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Failure, Reference } from "@opencode-ai/schema/skill-library"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers
    .handle("skill.list", () => response(SkillV2.Service.use((skill) => skill.list())))
    .handle("skill.installed", () => response(SkillLibrary.Service.use((library) => library.list())))
    .handle("skill.available", () =>
      response(
        Effect.gen(function* () {
          const plugins = yield* PluginV2.Service
          yield* plugins.wait(PluginV2.ID.make("config-skill"))
          const library = yield* SkillLibrary.Service
          const skill = yield* SkillV2.Service
          yield* skill.reload()
          return [...(yield* library.list()), ...(yield* skill.list()).map(SkillSelection.source)]
        }),
      ),
    )
    .handle("skill.search", ({ query }) => response(SkillLibrary.Service.use((library) => library.search(query.q))))
    .handle("skill.read", ({ payload }) =>
      response(SkillLibrary.Service.use((library) => library.read(payload.source))),
    )
    .handle("skill.content", ({ payload }) =>
      response(SkillTranslation.Service.use((translation) => translation.content(payload.source))),
    )
    .handle("skill.translate", ({ payload }) =>
      response(
        Effect.gen(function* () {
          const plugins = yield* PluginV2.Service
          yield* plugins.wait(PluginV2.ID.make("config-provider"))
          const translation = yield* SkillTranslation.Service
          return yield* translation.translate(payload)
        }),
      ),
    )
    .handle("skill.install", ({ payload }) =>
      response(SkillLibrary.Service.use((library) => library.install(payload.source, undefined, payload.id))),
    )
    .handle("skill.operation", ({ params }) =>
      response(
        SkillLibrary.Service.use((library) =>
          library.operation(params.id).pipe(Effect.map((operation) => operation ?? null)),
        ),
      ),
    )
    .handle("skill.remove", ({ params }) =>
      response(SkillLibrary.Service.use((library) => library.remove(params.id).pipe(Effect.as(true)))),
    )
    .handle("skill.prepare", ({ payload }) =>
      response(
        Effect.gen(function* () {
          const library = yield* SkillLibrary.Service
          const skills = yield* SkillV2.Service
          const installed = yield* library.list()
          yield* skills.reload()
          const existing = yield* skills.list()
          const refs: Reference[] = []
          for (const item of payload.skills) {
            const known = installed.find((entry) => entry.id === item.id)
            if (item.revision || known) {
              const revision = item.revision ?? known!.revision
              refs.push({ skillId: item.id, revision, contentHash: revision })
              continue
            }
            const local = existing.find((entry) => SkillSelection.source(entry).id === item.id)
            if (!local)
              return yield* new Failure({
                code: "NOT_FOUND",
                stage: "resolving",
                message: "Selected skill is unavailable",
              })
            const snapshot = yield* SkillSelection.snapshot(library, local)
            refs.push({ skillId: snapshot.id, revision: snapshot.revision, contentHash: snapshot.contentHash })
          }
          return yield* library.pin(payload.owner, refs, payload.restoreFrom)
        }),
      ),
    ),
).pipe(Layer.provide(AppNodeBuilder.build(SkillLibrary.node)))
