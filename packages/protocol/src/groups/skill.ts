import { Skill } from "@opencode-ai/schema/skill"
import { SkillLibrary } from "@opencode-ai/schema/skill-library"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const SkillGroup = HttpApiGroup.make("server.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.list",
          summary: "List skills",
          description: "Retrieve currently registered skills.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("skill.installed", "/api/skill/library", {
      query: LocationQuery,
      success: Location.response(Schema.Array(SkillLibrary.Installed)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.installed" })),
  )
  .add(
    HttpApiEndpoint.get("skill.available", "/api/skill/available", {
      query: LocationQuery,
      success: Location.response(Schema.Array(SkillLibrary.Selectable)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.available" })),
  )
  .add(
    HttpApiEndpoint.get("skill.search", "/api/skill/search", {
      query: Schema.Struct({ ...LocationQuery.fields, q: Schema.String }),
      success: Location.response(Schema.Array(SkillLibrary.Candidate)),
      error: SkillLibrary.Failure,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.search" })),
  )
  .add(
    HttpApiEndpoint.post("skill.read", "/api/skill/read", {
      query: LocationQuery,
      payload: Schema.Struct({ source: SkillLibrary.ReadSource }),
      success: Location.response(SkillLibrary.ReadResult),
      error: SkillLibrary.Failure,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.read" })),
  )
  .add(
    HttpApiEndpoint.post("skill.content", "/api/skill/content", {
      query: LocationQuery,
      payload: Schema.Struct({ source: SkillLibrary.TranslationSource }),
      success: Location.response(SkillLibrary.Content),
      error: SkillLibrary.Failure,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.content" })),
  )
  .add(
    HttpApiEndpoint.post("skill.translate", "/api/skill/translate", {
      query: LocationQuery,
      payload: Schema.Struct({
        source: SkillLibrary.TranslationSource,
        includeMarkdown: Schema.Boolean,
        model: Schema.Struct({ providerID: Schema.String, modelID: Schema.String }).pipe(Schema.optional),
      }),
      success: Location.response(SkillLibrary.Translation),
      error: SkillLibrary.Failure,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.translate" })),
  )
  .add(
    HttpApiEndpoint.post("skill.install", "/api/skill/install", {
      query: LocationQuery,
      payload: Schema.Struct({ id: Schema.optional(Schema.String), source: SkillLibrary.InstallSource }),
      success: Location.response(SkillLibrary.Operation),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.install" })),
  )
  .add(
    HttpApiEndpoint.get("skill.operation", "/api/skill/operation/:id", {
      query: LocationQuery,
      params: { id: Schema.String },
      success: Location.response(Schema.NullOr(SkillLibrary.Operation)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.operation" })),
  )
  .add(
    HttpApiEndpoint.delete("skill.remove", "/api/skill/library/:id", {
      query: LocationQuery,
      params: { id: SkillLibrary.ID },
      success: Location.response(Schema.Boolean),
      error: SkillLibrary.Failure,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.remove" })),
  )
  .add(
    HttpApiEndpoint.post("skill.prepare", "/api/skill/selection", {
      query: LocationQuery,
      payload: Schema.Struct({
        owner: Schema.String,
        restoreFrom: Schema.optional(Schema.String),
        skills: Schema.Array(Schema.Struct({ id: SkillLibrary.ID, revision: Schema.optional(SkillLibrary.Hash) })),
      }),
      success: Location.response(Schema.Array(SkillLibrary.Reference)),
      error: SkillLibrary.Failure,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.skill.prepare" })),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skills",
      description: "Experimental skill routes.",
    }),
  )
