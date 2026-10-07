export * as SkillLibrary from "./library"

import { resolveBrand } from "@opencode-ai/brand"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rename, rm, lstat, readdir, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema, Exit, Cause } from "effect"
import { SkillLibrary } from "@opencode-ai/schema/skill-library"
import { Database } from "../database/database"
import { Global } from "../global"
import { makeGlobalNode } from "../effect/app-node"
import { Flock } from "../util/flock"
import { SkillArchive } from "./archive"
import { SkillProviders } from "./providers"
import {
  SkillIdentityTable,
  SkillRevisionTable,
  SkillInstallationTable,
  SkillReferenceTable,
  SkillOperationTable,
  SkillSelectionTable,
} from "./library.sql"

export const identity = (source: Pick<SkillLibrary.Identity, "sourceType" | "repository" | "path">) =>
  `sk_${SkillArchive.hash(JSON.stringify([source.sourceType, source.repository, source.path]))}`

export interface Settings {
  registryUrl?: string
  allowDirect?: boolean
  registry?: SkillProviders.RegistryProvider
  artifacts?: SkillProviders.ArtifactProvider
}
export type Progress = (operation: SkillLibrary.Operation) => Effect.Effect<void>
export interface Interface {
  readonly list: () => Effect.Effect<SkillLibrary.Installed[]>
  readonly read: (source: SkillLibrary.ReadSource) => Effect.Effect<SkillLibrary.ReadResult, SkillLibrary.Failure>
  readonly preview: (id: string) => Effect.Effect<SkillLibrary.Preview, SkillLibrary.Failure>
  readonly search: (query: string) => Effect.Effect<SkillLibrary.Candidate[], SkillLibrary.Failure>
  readonly install: (
    source: SkillLibrary.InstallSource,
    progress?: Progress,
    operationID?: string,
  ) => Effect.Effect<SkillLibrary.Operation>
  readonly importEntries: (
    source: SkillLibrary.Identity,
    entries: SkillArchive.Entry[],
    managed?: boolean,
    upstreamRevision?: string,
  ) => Effect.Effect<SkillLibrary.Installed, SkillLibrary.Failure>
  readonly pin: (
    owner: string,
    refs: readonly SkillLibrary.Reference[],
    restoreFrom?: string,
  ) => Effect.Effect<SkillLibrary.Reference[], SkillLibrary.Failure>
  readonly load: (
    ref: SkillLibrary.Reference,
  ) => Effect.Effect<
    { path: string; identity: SkillLibrary.Identity; revision: SkillLibrary.Revision },
    SkillLibrary.Failure
  >
  readonly remove: (id: string) => Effect.Effect<void, SkillLibrary.Failure>
  readonly operation: (id: string) => Effect.Effect<SkillLibrary.Operation | undefined>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/SkillLibrary") {}

const error = (stage: SkillLibrary.Operation["stage"], cause: unknown, code = "INVALID_SKILL") =>
  new SkillLibrary.Failure({ stage, code, message: cause instanceof Error ? cause.message : String(cause) })
const io = <A>(f: () => Promise<A>, stage: SkillLibrary.Operation["stage"] = "validating") =>
  Effect.tryPromise({ try: f, catch: (cause) => error(stage, cause) })

export function make(db: Database.Interface["db"], root: string, settings: Settings = {}): Interface {
  const objectPath = (hash: string) => path.join(root, "objects", Schema.decodeUnknownSync(SkillLibrary.Hash)(hash))
  const locked = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(
      io(() => Flock.acquire("library", { dir: path.join(root, "locks") }), "installing"),
      () => effect,
      (lease) => Effect.promise(() => lease.release()),
    )
  const list = Effect.fn("SkillLibrary.list")(function* () {
    const rows = yield* db
      .select()
      .from(SkillInstallationTable)
      .innerJoin(SkillIdentityTable, eq(SkillIdentityTable.id, SkillInstallationTable.skill_id))
      .innerJoin(
        SkillRevisionTable,
        and(
          eq(SkillRevisionTable.skill_id, SkillInstallationTable.skill_id),
          eq(SkillRevisionTable.revision, SkillInstallationTable.revision),
        ),
      )
      .pipe(Effect.orDie)
    return rows.map(
      (row): SkillLibrary.Installed => ({
        ...(row.skill_revision.data.identity ?? row.skill_identity.data),
        revision: row.skill_installation.revision,
        contentHash: row.skill_installation.revision,
        installedAt: row.skill_installation.installed_at,
        managed: !["project", "builtin"].includes(row.skill_identity.data.sourceType),
      }),
    )
  })
  const load = Effect.fn("SkillLibrary.load")(function* (ref: SkillLibrary.Reference) {
    yield* Effect.try({
      try: () => Schema.decodeUnknownSync(SkillLibrary.Reference)(ref),
      catch: (cause) => error("validating", cause),
    })
    const row = yield* db
      .select()
      .from(SkillRevisionTable)
      .innerJoin(SkillIdentityTable, eq(SkillIdentityTable.id, SkillRevisionTable.skill_id))
      .where(and(eq(SkillRevisionTable.skill_id, ref.skillId), eq(SkillRevisionTable.revision, ref.revision)))
      .get()
      .pipe(Effect.orDie)
    if (!row || row.skill_revision.data.contentHash !== ref.contentHash)
      return yield* error("validating", "Locked skill revision is unavailable", "REVISION_UNAVAILABLE")
    const files = yield* io(() => SkillArchive.folder(objectPath(ref.contentHash), row.skill_revision.data.files))
    const checked = yield* Effect.try({
      try: () => SkillArchive.validate(files),
      catch: (cause) => error("validating", cause),
    })
    if (checked.contentHash !== ref.contentHash)
      return yield* error("validating", "Locked skill revision failed integrity verification", "HASH_MISMATCH")
    return {
      path: objectPath(ref.contentHash),
      identity: row.skill_revision.data.identity ?? {
        ...row.skill_identity.data,
        name: checked.name,
        description: checked.description,
      },
      revision: row.skill_revision.data,
    }
  })
  const importEntries = (
    source: SkillLibrary.Identity,
    entries: SkillArchive.Entry[],
    managed = true,
    upstreamRevision?: string,
  ) =>
    locked(
      Effect.gen(function* () {
        const checked = yield* Effect.try({
          try: () => SkillArchive.validate(entries),
          catch: (cause) => error("validating", cause),
        })
        if (identity(source) !== source.id || checked.name !== source.name)
          return yield* error("validating", "Skill identity does not match its content", "SOURCE_CONFLICT")
        yield* io(() => mkdir(path.join(root, "staging"), { recursive: true }), "installing")
        yield* io(() => mkdir(path.join(root, "objects"), { recursive: true }), "installing")
        // Holding the global installation lease means these stages belong to interrupted previous writers.
        yield* io(async () => {
          for (const name of await readdir(path.join(root, "staging")))
            if (name.startsWith("install-"))
              await rm(path.join(root, "staging", name), { recursive: true, force: true })
        }, "installing")
        const stage = yield* io(() => mkdtemp(path.join(root, "staging", "install-")), "installing")
        return yield* Effect.gen(function* () {
          const exists = yield* io(
            () =>
              lstat(objectPath(checked.contentHash))
                .then(() => true)
                .catch((cause: NodeJS.ErrnoException) => {
                  if (cause.code === "ENOENT") return false
                  throw cause
                }),
            "installing",
          )
          if (!exists) {
            yield* io(() => SkillArchive.write(stage, entries), "installing")
            yield* io(() => rename(stage, objectPath(checked.contentHash)), "installing")
          }
          if (exists) {
            const current = yield* io(() => SkillArchive.folder(objectPath(checked.contentHash), checked.files))
            if (SkillArchive.validate(current).contentHash !== checked.contentHash)
              return yield* error("validating", "Existing content-addressed object is damaged", "HASH_MISMATCH")
          }
          const installedAt = Date.now()
          const revision: SkillLibrary.Revision = {
            skillId: source.id,
            identity: source,
            revision: checked.contentHash,
            contentHash: checked.contentHash,
            files: checked.files,
            installedAt,
            upstreamRevision,
          }
          yield* db
            .transaction(() =>
              Effect.gen(function* () {
                yield* db
                  .insert(SkillIdentityTable)
                  .values({ id: source.id, data: source })
                  .onConflictDoUpdate({ target: SkillIdentityTable.id, set: { data: source } })
                yield* db
                  .insert(SkillRevisionTable)
                  .values({ skill_id: source.id, revision: revision.revision, data: revision })
                  .onConflictDoNothing()
                if (managed)
                  yield* db
                    .insert(SkillInstallationTable)
                    .values({ skill_id: source.id, revision: revision.revision, installed_at: installedAt })
                    .onConflictDoUpdate({
                      target: SkillInstallationTable.skill_id,
                      set: { revision: revision.revision, installed_at: installedAt },
                    })
              }),
            )
            .pipe(Effect.orDie)
          // Object bytes were fully validated before publication; DB read-back verifies the committed record.
          const saved = yield* db
            .select()
            .from(SkillRevisionTable)
            .where(and(eq(SkillRevisionTable.skill_id, source.id), eq(SkillRevisionTable.revision, revision.revision)))
            .get()
            .pipe(Effect.orDie)
          if (!saved) return yield* error("refreshing", "Revision read-back failed", "REFRESH_FAILED")
          return { ...source, revision: revision.revision, contentHash: revision.contentHash, installedAt, managed }
        }).pipe(
          Effect.ensuring(Effect.promise(() => rm(stage, { recursive: true, force: true }))),
          Effect.uninterruptible,
        )
      }),
    )
  const save = (operation: SkillLibrary.Operation) =>
    db
      .insert(SkillOperationTable)
      .values({ id: operation.id, data: operation })
      .onConflictDoUpdate({ target: SkillOperationTable.id, set: { data: operation } })
      .pipe(Effect.orDie, Effect.asVoid)
  const providers = SkillProviders.http(settings.registryUrl)
  const registry = settings.registry ?? providers.registry
  const artifacts = settings.artifacts ?? providers.artifacts
  const search = Effect.fn("SkillLibrary.search")(function* (query: string) {
    const candidates = yield* io(() => registry.search(query), "resolving")
    const installed = yield* list()
    return candidates.map((candidate) => ({
      ...candidate,
      installed: installed.some((item) => item.id === candidate.id && item.revision === candidate.revision),
    }))
  })
  const resolveSource = Effect.fn("SkillLibrary.resolveSource")(function* (
    source: Exclude<SkillLibrary.ReadSource, { type: "candidate" }>,
    report: (stage: SkillLibrary.Operation["stage"]) => Effect.Effect<unknown> = () => Effect.void,
  ) {
    if (source.type === "local") {
      yield* report("downloading")
      const entries = yield* io(async () => {
        const stat = await lstat(source.path)
        if (stat.isSymbolicLink()) throw new Error("Symbolic links cannot be imported")
        if (stat.isDirectory()) return SkillArchive.folder(source.path)
        if (!stat.isFile() || stat.size > SkillArchive.limits.download) throw new Error("Invalid or oversized ZIP")
        return SkillArchive.unzip(await readFile(source.path))
      }, "downloading")
      yield* report("validating")
      const checked = yield* Effect.try({
        try: () => SkillArchive.validate(entries),
        catch: (cause) => error("validating", cause),
      })
      const provenance = { sourceType: "local" as const, repository: path.resolve(source.path), path: "" }
      return {
        entries,
        identity: {
          ...provenance,
          id: identity(provenance),
          name: checked.name,
          description: checked.description,
        },
      }
    }
    const resolution =
      source.type === "registry"
        ? io(() => registry.revision(source.id, source.revision), "resolving")
        : io(() => registry.resolve(source.url), "resolving")
    const attempt = yield* Effect.result(resolution)
    if (attempt._tag === "Failure") {
      if (source.type !== "url" || !settings.allowDirect) return yield* attempt.failure
      yield* report("downloading")
      const direct = yield* io(async () => (await import("./source")).github(source.url), "downloading")
      yield* report("validating")
      return direct
    }
    const candidate = attempt.success
    if (candidate.sourceType === "builtin" || candidate.sourceType === "project")
      return yield* error("validating", "Registry cannot impersonate a built-in or project skill", "SOURCE_CONFLICT")
    if (source.type === "registry" && (candidate.id !== source.id || candidate.revision !== source.revision))
      return yield* error("resolving", "Registry returned a different skill revision", "SOURCE_CONFLICT")
    yield* report("downloading")
    const bytes = yield* io(() => artifacts.download(candidate), "downloading")
    yield* report("validating")
    if (SkillArchive.hash(bytes) !== candidate.artifactHash)
      return yield* error("validating", "Artifact checksum mismatch", "HASH_MISMATCH")
    const entries = yield* io(() => SkillArchive.unzip(bytes))
    const checked = yield* Effect.try({
      try: () => SkillArchive.validate(entries),
      catch: (cause) => error("validating", cause),
    })
    if (checked.contentHash !== candidate.contentHash || candidate.revision !== checked.contentHash)
      return yield* error("validating", "Revision checksum mismatch", "HASH_MISMATCH")
    return {
      entries,
      upstreamRevision: candidate.upstreamRevision,
      identity: {
        id: candidate.id,
        name: candidate.name,
        description: candidate.description,
        sourceType: candidate.sourceType,
        repository: candidate.repository,
        path: candidate.path,
      },
    }
  })
  const previewHash = (data: Omit<SkillLibrary.Preview, "previewId">) =>
    SkillArchive.hash(
      JSON.stringify([
        data.id,
        data.name,
        data.description,
        data.sourceType,
        data.repository,
        data.path,
        data.revision,
        data.contentHash,
        data.upstreamRevision ?? null,
        data.skillMarkdown,
      ]),
    )
  const previewPath = (id: string) =>
    path.join(root, "previews", `${Schema.decodeUnknownSync(SkillLibrary.Hash)(id)}.json`)
  const readPreview = Effect.fn("SkillLibrary.preview")(function* (id: string) {
    const saved = yield* io(async () =>
      Schema.decodeUnknownSync(SkillLibrary.Preview)(JSON.parse(await readFile(previewPath(id), "utf8"))),
    )
    const { previewId, ...data } = saved
    if (previewId !== id || previewHash(data) !== previewId)
      return yield* error("validating", "Preview integrity check failed", "HASH_MISMATCH")
    return saved
  })
  const read = Effect.fn("SkillLibrary.read")(function* (input: SkillLibrary.ReadSource) {
    const source = yield* Effect.gen(function* () {
      if (input.type === "candidate") {
        const { SkillSource } = yield* io(() => import("./source"))
        const parsed = yield* Effect.try({
          try: () => SkillSource.parse(input.candidate.url),
          catch: (cause) => error("resolving", cause),
        })
        if (
          parsed.repository !== input.candidate.repository ||
          parsed.path !== input.candidate.path ||
          parsed.ref !== input.candidate.upstreamRevision ||
          !/^[a-f0-9]{40}$/.test(parsed.ref)
        )
          return yield* error("resolving", "Candidate does not identify its fixed source commit", "SOURCE_CONFLICT")
        return { type: "url" as const, url: input.candidate.url }
      }
      if (input.type !== "url") return input
      const found = yield* io(async () => {
        if (registry.discover) {
          try {
            return await registry.discover(input.url)
          } catch (cause) {
            if (!settings.allowDirect) throw cause
          }
        } else if (!settings.allowDirect) throw new Error("Registry discovery is unavailable")
        const { SkillSource } = await import("./source")
        return SkillSource.discover(input.url)
      }, "resolving")
      if (found.length !== 1) return { type: "candidates" as const, candidates: found }
      return { type: "url" as const, url: found[0].url }
    })
    if (source.type === "candidates") return source
    const resolved = yield* resolveSource(source)
    const saved = yield* importEntries(
      resolved.identity,
      resolved.entries,
      false,
      "upstreamRevision" in resolved ? resolved.upstreamRevision : undefined,
    )
    const data = {
      ...resolved.identity,
      revision: saved.revision,
      contentHash: saved.contentHash,
      ...("upstreamRevision" in resolved ? { upstreamRevision: resolved.upstreamRevision } : {}),
      skillMarkdown: new TextDecoder().decode(resolved.entries.find((entry) => entry.path === "SKILL.md")!.bytes),
    }
    const preview = { ...data, previewId: previewHash(data) }
    yield* io(async () => {
      await mkdir(path.join(root, "previews"), { recursive: true })
      // Same input produces the same immutable handle, even after restart.
      const temporary = path.join(root, "previews", `${randomUUID()}.tmp`)
      await writeFile(temporary, JSON.stringify(preview))
      await rename(temporary, previewPath(preview.previewId))
    })
    return { type: "preview" as const, preview }
  })
  return {
    list,
    read,
    preview: readPreview,
    load,
    search,
    importEntries,
    operation: (id) =>
      db
        .select()
        .from(SkillOperationTable)
        .where(eq(SkillOperationTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.map((row) => row?.data),
        ),
    install: Effect.fn("SkillLibrary.install")(function* (
      source: SkillLibrary.InstallSource,
      progress?: Progress,
      operationID?: string,
    ) {
      const id = operationID ?? randomUUID()
      let stage: SkillLibrary.Operation["stage"] = "resolving"
      const report = (next: SkillLibrary.Operation["stage"], extra: Partial<SkillLibrary.Operation> = {}) =>
        Effect.gen(function* () {
          stage = next
          const operation: SkillLibrary.Operation = { id, stage: next, updatedAt: Date.now(), ...extra }
          yield* save(operation)
          if (progress) yield* progress(operation)
          return operation
        })
      return yield* Effect.gen(function* () {
        yield* report("resolving")
        const resolved = yield* Effect.gen(function* () {
          if (source.type !== "preview")
            return yield* error(
              "resolving",
              "Read the skill first and install its immutable preview",
              "PREVIEW_REQUIRED",
            )
          const preview = yield* readPreview(source.previewId)
          const loaded = yield* load({
            skillId: preview.id,
            revision: preview.revision,
            contentHash: preview.contentHash,
          })
          const installed = (yield* list()).find((item) => item.id === preview.id && item.revision === preview.revision)
          if (installed) return { installed }
          yield* report("validating")
          return {
            identity: {
              id: preview.id,
              name: preview.name,
              description: preview.description,
              sourceType: preview.sourceType,
              repository: preview.repository,
              path: preview.path,
            },
            entries: yield* io(() => SkillArchive.folder(loaded.path, loaded.revision.files)),
            upstreamRevision: preview.upstreamRevision,
          }
        })
        if ("installed" in resolved)
          return yield* report("completed", { result: resolved.installed, alreadyInstalled: true })
        yield* report("installing")
        const result = yield* importEntries(
          resolved.identity,
          resolved.entries,
          true,
          "upstreamRevision" in resolved ? resolved.upstreamRevision : undefined,
        )
        yield* report("refreshing")
        if (!(yield* list()).some((item) => item.id === result.id && item.revision === result.revision))
          return yield* error("refreshing", "Installation read-back failed", "REFRESH_FAILED")
        return yield* report("completed", { result })
      }).pipe(
        Effect.catch((cause) => report("failed", { error: { code: cause.code, message: cause.message, stage } })),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && stage !== "completed" && stage !== "failed"
            ? report("failed", { error: { code: "INTERRUPTED", message: Cause.pretty(exit.cause), stage } }).pipe(
                Effect.asVoid,
              )
            : Effect.void,
        ),
      )
    }),
    pin: (owner, refs, restoreFrom) =>
      locked(
        Effect.gen(function* () {
          if (!owner) return yield* error("validating", "Missing task reference owner")
          const unique = new Map(refs.map((ref) => [ref.skillId, ref]))
          if (unique.size !== refs.length) return yield* error("validating", "Duplicate skill selections")
          const previous = yield* db
            .select()
            .from(SkillSelectionTable)
            .where(eq(SkillSelectionTable.owner, owner))
            .get()
            .pipe(Effect.orDie)
          if (
            previous &&
            (previous.refs.length !== refs.length ||
              previous.refs.some(
                (item) =>
                  !refs.some(
                    (ref) =>
                      ref.skillId === item.skillId &&
                      ref.revision === item.revision &&
                      ref.contentHash === item.contentHash,
                  ),
              ))
          )
            return yield* error("validating", "Task skill selection is already locked", "REFERENCE_CONFLICT")
          const origin = restoreFrom
            ? yield* db
                .select()
                .from(SkillSelectionTable)
                .where(eq(SkillSelectionTable.owner, restoreFrom))
                .get()
                .pipe(Effect.orDie)
            : undefined
          const restored =
            origin &&
            origin.refs.length === refs.length &&
            origin.refs.every((item) =>
              refs.some(
                (ref) =>
                  ref.skillId === item.skillId &&
                  ref.revision === item.revision &&
                  ref.contentHash === item.contentHash,
              ),
            )
          if (restoreFrom && !restored)
            return yield* error("validating", "Original task skill selection does not match", "REFERENCE_CONFLICT")
          const installed = yield* list()
          for (const ref of refs) {
            const loaded = yield* load(ref)
            if (
              !previous &&
              !restored &&
              !["project", "builtin"].includes(loaded.identity.sourceType) &&
              !installed.some((item) => item.id === ref.skillId && item.revision === ref.revision)
            )
              return yield* error("validating", "Selected skill is no longer installed", "NOT_INSTALLED")
          }
          yield* db
            .transaction(() =>
              Effect.gen(function* () {
                yield* db.insert(SkillSelectionTable).values({ owner, refs }).onConflictDoNothing()
                for (const ref of refs)
                  yield* db
                    .insert(SkillReferenceTable)
                    .values({ owner, skill_id: ref.skillId, revision: ref.revision })
                    .onConflictDoNothing()
              }),
            )
            .pipe(Effect.orDie)
          return [...refs]
        }),
      ),
    remove: (id) =>
      locked(
        Effect.gen(function* () {
          yield* db.delete(SkillInstallationTable).where(eq(SkillInstallationTable.skill_id, id)).pipe(Effect.orDie)
          // Retain immutable revisions for task restore; uninstall only removes the Installation.
        }),
      ),
  }
}

export { download } from "./providers"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const global = yield* Global.Service
    const brand = resolveBrand()
    return Service.of(
      make(database.db, path.join(global.data, "skill-library"), {
        registryUrl:
          brand.id === "hubu"
            ? process.env.HUBU_SKILL_REGISTRY_URL
            : brand.id === "kai"
              ? process.env.KCODE_SKILL_REGISTRY_URL
              : undefined,
        allowDirect: brand.id === "kai" && process.env.KCODE_SKILL_DIRECT_FALLBACK === "1",
      }),
    )
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Global.node] })
