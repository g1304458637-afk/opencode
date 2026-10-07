export * as CampusModel from "./campus-model"

import { Schema } from "effect"
import type { ModelsDev } from "../models-dev"

export const Info = Schema.Struct({
  id: Schema.NonEmptyString,
  modalities: Schema.optional(Schema.Struct({ input: Schema.Array(Schema.String) })),
  capabilities: Schema.optional(
    Schema.Struct({
      input: Schema.optional(
        Schema.Union([Schema.Array(Schema.String), Schema.Struct({ image: Schema.optional(Schema.Boolean) })]),
      ),
      reasoning: Schema.optional(Schema.Boolean),
    }),
  ),
  reasoning: Schema.optional(Schema.Boolean),
})
export type Info = typeof Info.Type

// Explicit gateway metadata wins, including a text-only declaration. Otherwise
// use an exact catalog ID match; unknown gateway aliases remain conservative.
export function image(model: Info, known?: Pick<ModelsDev.Model, "modalities">) {
  if (model.modalities) return model.modalities.input.includes("image")
  const input = model.capabilities?.input
  if (Array.isArray(input)) return input.includes("image")
  if (input && "image" in input && input.image !== undefined) return input.image
  return known?.modalities?.input.includes("image") ?? false
}
