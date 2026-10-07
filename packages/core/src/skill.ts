export * as SkillV2 from "./skill"

import { resolveBrand } from "@opencode-ai/brand"
import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema, Types } from "effect"
import { Skill } from "@opencode-ai/schema/skill"
import { AgentV2 } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { FSUtil } from "./fs-util"
import { PermissionV2 } from "./permission"
import { AbsolutePath } from "./schema"
import { SkillDiscovery } from "./skill/discovery"
import { State } from "./state"
import { SkillLibrary } from "./skill/library"
import { Reference, Failure } from "@opencode-ai/schema/skill-library"
import { readFile } from "node:fs/promises"

export const DirectorySource = Skill.DirectorySource
export type DirectorySource = Skill.DirectorySource

export const UrlSource = Skill.UrlSource
export type UrlSource = Skill.UrlSource

export const EmbeddedSource = Skill.EmbeddedSource
export type EmbeddedSource = Skill.EmbeddedSource

export const Source = Skill.Source
export type Source = typeof Source.Type

export const Info = Skill.Info
export type Info = Skill.Info

export function parseFile(filepath: string, content: string): Info | undefined {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return
  const frontmatter = decodeFrontmatter(markdown.data).valueOrUndefined
  if (!frontmatter) return
  if (!frontmatter.name && path.basename(filepath) === "SKILL.md") return
  const name = frontmatter.name ?? path.basename(filepath, ".md")
  return {
    name,
    description: frontmatter.description,
    slash: frontmatter.slash,
    location: AbsolutePath.make(filepath),
    content: markdown.content,
  }
}

// The same markdown parser used by discovery loads only SKILL.md into model context.
// Other revision resources remain files and are read by ordinary tools only when needed.
export const loadRevision = (library: SkillLibrary.Interface, ref: Reference) =>
  Effect.gen(function* () {
    const revision = yield* library.load(ref)
    const filename = path.join(revision.path, "SKILL.md")
    const raw = yield* Effect.tryPromise({
      try: () => readFile(filename, "utf8"),
      catch: (cause) => new Failure({ code: "READ_FAILED", stage: "validating", message: String(cause) }),
    })
    const info = parseFile(filename, raw)
    if (!info)
      return yield* new Failure({ code: "INVALID_SKILL", stage: "validating", message: "Cannot load locked SKILL.md" })
    return info
  })

export const available = (skills: ReadonlyArray<Info>, agent: AgentV2.Info) =>
  skills.filter((skill) => PermissionV2.evaluate("skill", skill.name, agent.permissions).effect !== "deny")

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)

export type Data = {
  sources: Types.DeepMutable<Source>[]
}

export type Draft = {
  source: (source: Source) => void
  list: () => readonly Source[]
}

export interface Interface extends State.Transformable<Draft> {
  readonly sources: () => Effect.Effect<Source[]>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Skill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service

    const state = State.create<Data, Draft>({
      initial: () => ({ sources: [] }),
      draft: (draft) => ({
        source: (source) => {
          if (draft.sources.some((item) => Source.equals(item, source))) return
          draft.sources.push(source as Types.DeepMutable<Source>)
        },
        list: () => draft.sources as Source[],
      }),
    })

    const load = Effect.fn("SkillV2.load")(function* (source: Source) {
      const skills: Info[] = []
      if (source.type === "embedded") return [source.skill]
      const directories = source.type === "directory" ? [source.path] : yield* discovery.pull(source.url)
      for (const directory of directories) {
        const files = yield* fs
          .glob("{*.md,**/SKILL.md}", { cwd: directory, absolute: true, include: "file", symlink: true, dot: true })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const filepath of files.toSorted()) {
          const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!content) continue
          const info = parseFile(filepath, content)
          if (info) skills.push(info)
        }
      }
      return skills
    })

    // QUESTION(Dax): Should local skill sources invalidate on filesystem watch
    // events, following the reload policy chosen for other context sources?
    const cache = new Map<string, Info[]>()
    const list = Effect.fn("SkillV2.list")(function* () {
      const skills = new Map<string, Info>()
      for (const source of state.get().sources) {
        const key = Source.key(source)
        const loaded = cache.get(key) ?? (yield* load(source))
        cache.set(key, loaded)
        for (const skill of loaded)
          skills.set(["hubu", "kai"].includes(resolveBrand().id) ? skill.location : skill.name, skill)
      }
      return Array.from(skills.values())
    })

    return Service.of({
      transform: state.transform,
      reload: () =>
        Effect.suspend(() => {
          cache.clear()
          return state.reload()
        }),
      sources: Effect.fn("SkillV2.sources")(function* () {
        return state.get().sources
      }),
      list,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [SkillDiscovery.node, FSUtil.node] })
