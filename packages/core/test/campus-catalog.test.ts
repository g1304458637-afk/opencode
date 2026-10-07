import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "../src/catalog"
import { ProviderV2 } from "../src/provider"
import { ModelsDev } from "../src/models-dev"
import { Config } from "../src/config"
import { ConfigProviderPlugin } from "../src/config/plugin/provider"
import { Integration } from "../src/integration"
import { PluginV2 } from "../src/plugin"
import { PluginHost } from "../src/plugin/host"
import { CampusPlugin } from "../src/plugin/provider/campus"
import { PluginTestLayer } from "./plugin/fixture"

test.each([false, true])("HUBU catalog discovers account models with existing provider=%s", async (configured) => {
  const brand = "hubu"
  let requests = 0
  let offline = false
  const gateway = Bun.serve({
    port: 0,
    fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer test-campus-credential")
      expect(new URL(request.url).pathname).toBe("/v1/models")
      requests++
      if (offline) return new Response("Unavailable", { status: 503 })
      return Response.json({ data: [{ id: "glm-5.3-flash", capabilities: { input: { image: true } } }] })
    },
  })
  const variables = {
    BRAND: brand,
    OPENCODE_CHANNEL: brand,
    [brand === "hubu" ? "HUBU_API_KEY" : "KAI_API_KEY"]: "test-campus-credential",
    [brand === "hubu" ? "HUBU_GATEWAY_URL" : "KAI_GATEWAY_URL"]: `http://127.0.0.1:${gateway.port}`,
  }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  Object.assign(process.env, variables)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        const host = yield* PluginHost.make(plugin)
        yield* Effect.gen(function* () {
          yield* CampusPlugin.effect(host)
          yield* ConfigProviderPlugin.Plugin.effect(host)
        }).pipe(
          Effect.provideService(Config.Service, {
            entries: () =>
              Effect.succeed(
                configured
                  ? [
                      {
                        type: "document" as const,
                        path: "fixture",
                        info: {
                          providers: {
                            sub2api: {
                              name: "configured HUBU provider",
                              api: {
                                type: "aisdk" as const,
                                package: "@ai-sdk/openai-compatible",
                                url: `http://127.0.0.1:${gateway.port}/v1`,
                              },
                            },
                          },
                        },
                      },
                    ]
                  : [],
              ),
          }),
          Effect.provideService(
            ModelsDev.Service,
            ModelsDev.Service.of({ get: () => Effect.succeed({}), refresh: () => Effect.void }),
          ),
        )
        const catalog = yield* Catalog.Service
        const models = yield* catalog.model.available()
        expect(models).toHaveLength(1)
        expect((yield* catalog.provider.get(ProviderV2.ID.make("sub2api")))?.name).toBe(
          configured ? "configured HUBU provider" : "campus ai",
        )
        expect(models[0]?.capabilities.input).toContain("image")
        expect(models[0]).toMatchObject({
          providerID: "sub2api",
          id: "glm-5.3-flash",
          api: { url: `http://127.0.0.1:${gateway.port}/v1` },
        })
        expect(JSON.stringify(models)).not.toContain("test-campus-credential")
        const integrations = yield* Integration.Service
        expect(yield* integrations.connection.active(Integration.ID.make("sub2api"))).toBeDefined()
        expect(requests).toBeGreaterThan(0)
        offline = true
        yield* catalog.reload()
        expect(yield* catalog.model.available()).toHaveLength(0)
        offline = false
        yield* catalog.reload()
        expect(yield* catalog.model.available()).toHaveLength(1)
      }).pipe(Effect.provide(PluginTestLayer), Effect.scoped),
    )
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    gateway.stop(true)
  }
})
