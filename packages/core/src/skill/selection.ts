export * as SkillSelection from "./selection"

import { resolveBrand } from "@opencode-ai/brand"
import path from "node:path"
import { Effect } from "effect"
import { SkillLibrary } from "./library"
import { SkillArchive } from "./archive"
import { SkillV2 } from "../skill"
import { toModelOutput } from "./format"
import type { Reference } from "@opencode-ai/schema/skill-library"

export const required = () => ["kai", "hubu"].includes(resolveBrand().id)

export function source(info: Pick<SkillV2.Info, "name" | "description" | "content"> & { location: string }) {
  const builtin = info.location === "<built-in>" || info.location.startsWith("/builtin/")
  const provenance = {
    sourceType: builtin ? ("builtin" as const) : ("project" as const),
    repository: builtin ? resolveBrand().credentialNamespace : path.dirname(info.location),
    path: builtin ? info.name : path.basename(info.location),
  }
  return {
    ...provenance,
    id: SkillLibrary.identity(provenance),
    name: info.name,
    description: info.description ?? "",
    managed: false,
    contentHash: SkillArchive.hash(JSON.stringify([info.name, info.description ?? "", info.content])),
  }
}

export const snapshot = (
  library: SkillLibrary.Interface,
  info: Pick<SkillV2.Info, "name" | "description" | "content"> & { location: string },
) =>
  Effect.gen(function* () {
    const identity = source(info)
    const entries =
      identity.sourceType === "builtin" || path.basename(info.location) !== "SKILL.md"
        ? [
            {
              path: "SKILL.md",
              bytes: new TextEncoder().encode(
                `---\nname: ${JSON.stringify(info.name)}\ndescription: ${JSON.stringify(info.description ?? "")}\n---\n${info.content}`,
              ),
              executable: false,
            },
          ]
        : yield* Effect.tryPromise({
            try: () => SkillArchive.folder(path.dirname(info.location)),
            catch: (cause) => new Error(String(cause)),
          }).pipe(Effect.orDie)
    return yield* library.importEntries(identity, entries, false)
  })

export const context = (
  library: SkillLibrary.Interface,
  refs: readonly Reference[],
  permitted: (name: string) => boolean = () => true,
) =>
  Effect.gen(function* () {
    const parts: string[] = []
    for (const ref of refs) {
      const info = yield* SkillV2.loadRevision(library, ref)
      if (!permitted(info.name)) return yield* Effect.die(new Error(`Skill permission denied: ${info.name}`))
      parts.push(toModelOutput(info, []))
    }
    return parts
  })
