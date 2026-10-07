import { resolveBrand } from "@opencode-ai/brand"
import { ModelsDev } from "../../models-dev"
import { CampusModel } from "../../provider/campus-model"
import { Effect, Schema } from "effect"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import type { PluginInternal } from "../internal"

// Both desktop backends use this catalog for skill translations. Credentials
// stay in the existing environment integration, never in catalog responses.
export const CampusPlugin = {
  id: "campus-gateway",
  effect: Effect.fn(function* (ctx: PluginContext) {
    const brand = resolveBrand()
    if (!brand.campus || !process.env[brand.apiKeyEnvVar]?.trim()) return
    const modelsDev = yield* ModelsDev.Service
    // Populate dynamic models even when legacy config already declares sub2api.
    // The later config-provider transform retains explicit model overrides.
    const baseURL = (process.env[brand.gatewayEnvVar]?.trim() || brand.gatewayURL).replace(/\/+$/, "") + "/v1"
    yield* ctx.integration.transform((integrations) => {
      integrations.update("sub2api", (item) => {
        item.name = brand.id === "kai" ? "K AI" : brand.id === "hubu" ? "campus ai" : "Sub2API"
      })
      integrations.method.update({ integrationID: "sub2api", method: { type: "env", names: [brand.apiKeyEnvVar] } })
    })
    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        const models = yield* Effect.tryPromise(async () => {
          const response = await fetch(`${baseURL}/models`, {
            headers: { Authorization: `Bearer ${process.env[brand.apiKeyEnvVar]}` },
            signal: AbortSignal.timeout(8000),
          })
          if (!response.ok) return []
          return Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(CampusModel.Info) }))(
            await response.json(),
          ).data
        }).pipe(Effect.catch(() => Effect.succeed([])))
        catalog.provider.update("sub2api", (provider) => {
          provider.name = brand.id === "kai" ? "K AI" : brand.id === "hubu" ? "campus ai" : "Sub2API"
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: baseURL }
        })
        const knownModels = yield* modelsDev.get()
        for (const item of models) {
          const known = Object.values(knownModels)
            .flatMap((entry) => Object.values(entry.models))
            .find((model) => model.id === item.id)
          catalog.model.update("sub2api", item.id, (model) => {
            model.name = item.id
            model.enabled = true
            model.capabilities = {
              tools: true,
              input: CampusModel.image(item, known) ? ["text", "image"] : ["text"],
              output: ["text"],
            }
            model.limit = { context: 128000, output: 8192 }
          })
        }
      }),
    )
  }),
} satisfies PluginInternal.Plugin<PluginInternal.Requirements>
