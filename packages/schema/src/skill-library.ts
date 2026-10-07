export * as SkillLibrary from "./skill-library"

import { Schema } from "effect"
import { optional } from "./schema"

export const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
export const ID = Schema.String.check(Schema.isPattern(/^sk_[a-f0-9]{64}$/))

export interface Reference extends Schema.Schema.Type<typeof Reference> {}
export const Reference = Schema.Struct({
  skillId: ID,
  revision: Hash,
  contentHash: Hash,
}).annotate({ identifier: "SkillLibrary.Reference" })

export interface Identity extends Schema.Schema.Type<typeof Identity> {}
export const Identity = Schema.Struct({
  id: ID,
  name: Schema.NonEmptyString,
  description: Schema.String,
  sourceType: Schema.Literals(["github", "local", "project", "builtin"]),
  repository: Schema.String,
  path: Schema.String,
}).annotate({ identifier: "SkillLibrary.Identity" })

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  path: Schema.String,
  hash: Hash,
  size: Schema.Finite,
  executable: Schema.Boolean,
}).annotate({ identifier: "SkillLibrary.File" })

export interface Revision extends Schema.Schema.Type<typeof Revision> {}
export const Revision = Schema.Struct({
  ...Reference.fields,
  identity: Identity.pipe(optional),
  files: Schema.Array(File),
  installedAt: Schema.Finite,
  upstreamRevision: Schema.String.pipe(optional),
}).annotate({ identifier: "SkillLibrary.Revision" })

export interface Installed extends Schema.Schema.Type<typeof Installed> {}
export const Installed = Schema.Struct({
  ...Identity.fields,
  revision: Hash,
  contentHash: Hash,
  installedAt: Schema.Finite,
  managed: Schema.Boolean,
}).annotate({ identifier: "SkillLibrary.Installed" })

export interface Candidate extends Schema.Schema.Type<typeof Candidate> {}
export const Candidate = Schema.Struct({
  ...Identity.fields,
  revision: Hash,
  contentHash: Hash,
  artifactUrl: Schema.String,
  artifactHash: Hash,
  upstreamRevision: Schema.String.pipe(optional),
  installed: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "SkillLibrary.Candidate" })

// Preview metadata is persisted locally and refers to an immutable CAS revision.
export interface Preview extends Schema.Schema.Type<typeof Preview> {}
export const Preview = Schema.Struct({
  ...Identity.fields,
  previewId: Hash,
  revision: Hash,
  contentHash: Hash,
  upstreamRevision: Schema.String.pipe(optional),
  skillMarkdown: Schema.String,
}).annotate({ identifier: "SkillLibrary.Preview" })

export const TranslationSource = Schema.Union([
  Schema.Struct({ type: Schema.Literal("preview"), previewId: Hash }),
  Schema.Struct({ type: Schema.Literal("revision"), reference: Reference }),
  Schema.Struct({ type: Schema.Literal("discovered"), id: ID, contentHash: Hash }),
]).annotate({ identifier: "SkillLibrary.TranslationSource" })
export type TranslationSource = Schema.Schema.Type<typeof TranslationSource>

export const TranslationRequest = Schema.Struct({
  source: TranslationSource,
  includeMarkdown: Schema.Boolean,
  model: Schema.Struct({ providerID: Schema.String, modelID: Schema.String }).pipe(optional),
}).annotate({ identifier: "SkillLibrary.TranslationRequest" })
export type TranslationRequest = Schema.Schema.Type<typeof TranslationRequest>

export const Content = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  skillMarkdown: Schema.String,
  contentHash: Hash,
}).annotate({ identifier: "SkillLibrary.Content" })
export type Content = Schema.Schema.Type<typeof Content>

export interface Translation extends Schema.Schema.Type<typeof Translation> {}
export const Translation = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  skillMarkdown: Schema.String.pipe(optional),
}).annotate({ identifier: "SkillLibrary.Translation" })

export interface SourceCandidate extends Schema.Schema.Type<typeof SourceCandidate> {}
export const SourceCandidate = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  upstreamRevision: Schema.String,
  url: Schema.String,
}).annotate({ identifier: "SkillLibrary.SourceCandidate" })

export const ReadSource = Schema.Union([
  Schema.Struct({ type: Schema.Literal("candidate"), candidate: SourceCandidate }),
  Schema.Struct({ type: Schema.Literal("url"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("local"), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal("registry"), id: ID, revision: Hash }),
])
export type ReadSource = Schema.Schema.Type<typeof ReadSource>
export const ReadResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("preview"), preview: Preview }),
  Schema.Struct({ type: Schema.Literal("candidates"), candidates: Schema.Array(SourceCandidate) }),
]).annotate({ identifier: "SkillLibrary.ReadResult" })
export type ReadResult = Schema.Schema.Type<typeof ReadResult>

export const Stage = Schema.Literals([
  "resolving",
  "downloading",
  "validating",
  "installing",
  "refreshing",
  "completed",
  "failed",
])

export interface Operation extends Schema.Schema.Type<typeof Operation> {}
export const Operation = Schema.Struct({
  id: Schema.String,
  stage: Stage,
  updatedAt: Schema.Finite,
  result: Installed.pipe(optional),
  alreadyInstalled: Schema.Boolean.pipe(optional),
  error: Schema.Struct({ code: Schema.String, message: Schema.String, stage: Stage }).pipe(optional),
}).annotate({ identifier: "SkillLibrary.Operation" })

export const InstallSource = Schema.Struct({
  type: Schema.Literal("preview"),
  previewId: Hash,
}).annotate({ identifier: "SkillLibrary.InstallSource" })
export type InstallSource = Schema.Schema.Type<typeof InstallSource>

export interface Selectable extends Schema.Schema.Type<typeof Selectable> {}
export const Selectable = Schema.Struct({
  ...Identity.fields,
  revision: Hash.pipe(optional),
  contentHash: Hash.pipe(optional),
  managed: Schema.Boolean,
}).annotate({ identifier: "SkillLibrary.Selectable" })

export class Failure extends Schema.TaggedErrorClass<Failure>()("SkillLibraryFailure", {
  code: Schema.String,
  message: Schema.String,
  stage: Stage,
}) {}
