import type { ModelMessage } from "ai"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

// Mock Sub2API gateway: serves /v1/models only, with no modality metadata —
// matching the real gateway contract (ids are the entire discovery payload).
function mockGateway(models: string[]) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url)
      if (url.pathname === "/v1/models") {
        return Response.json({
          data: models.map((id) => ({
            id,
            type: "model",
            display_name: id,
            ...(id === "test-vision-model"
              ? { modalities: { input: ["text", "image"] } }
              : ["test-text-only", "openai/gpt-5.2-pro"].includes(id)
                ? { capabilities: { input: { image: false } } }
                : {}),
          })),
        })
      }
      return new Response("not found", { status: 404 })
    },
  })
}

const layer = () =>
  LayerNode.compile(
    LayerNode.group([
      Provider.node,
      FSUtil.node,
      Env.node,
      Config.node,
      Auth.node,
      Plugin.node,
      ModelsDev.node,
      RuntimeFlags.node,
    ]),
    [],
  )

const it = testEffect(layer())

// Mock gateway lives at module scope so it is reachable when the instance's
// provider state initializes during the test run below.
const gateway = mockGateway([
  "test-vision-model",
  "test-text-only",
  "unknown-gateway-alias",
  "glm-5.3-thinking",
  "google/gemini-2.5-pro",
  "openai/gpt-5.2-pro",
])

const IMAGE_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

it.instance(
  "Sub2API dynamic models declare image input capability",
  Effect.gen(function* () {
    const providers = yield* Provider.use.list()
    const sub2api = providers[ProviderV2.ID.make("sub2api")]
    expect(sub2api).toBeDefined()
    const model = sub2api!.models[ModelV2.ID.make("test-vision-model")]
    expect(model).toBeDefined()
    // Regression under test: gateway-discovered models must not declare
    // text-only, or unsupportedParts() silently strips user image parts.
    expect(model!.capabilities.input.image).toBe(true)
    expect(model!.capabilities.attachment).toBe(true)
    expect(model!.capabilities.input.text).toBe(true)
    // Non-image modalities stay conservative.
    expect(model!.capabilities.input.audio).toBe(false)
    expect(model!.capabilities.input.video).toBe(false)
    expect(model!.capabilities.input.pdf).toBe(false)
    expect(sub2api!.models[ModelV2.ID.make("test-text-only")]!.capabilities.input.image).toBe(false)
    expect(sub2api!.models[ModelV2.ID.make("unknown-gateway-alias")]!.capabilities.input.image).toBe(false)
    expect(sub2api!.models[ModelV2.ID.make("google/gemini-2.5-pro")]!.capabilities.input.image).toBe(true)
    expect(sub2api!.models[ModelV2.ID.make("openai/gpt-5.2-pro")]!.capabilities.input.image).toBe(false)
    expect(Object.keys(sub2api!.models[ModelV2.ID.make("glm-5.3-thinking")]!.variants ?? {})).not.toHaveLength(0)
  }),
  {
    config: {
      provider: {
        sub2api: {
          name: "Sub2API",
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: `http://127.0.0.1:${gateway.port}/v1`,
            apiKey: "test-key",
            dynamicModels: true,
          },
        },
      },
    },
  },
)

describe("ProviderTransform.message - sub2api dynamic model keeps image parts", () => {
  // Mirrors mucDynamicModel() output shape after the vision fix.
  const dynamicModel = (overrides: Partial<Provider.Model> = {}): Provider.Model =>
    ({
      id: "test-vision-model",
      providerID: "sub2api",
      api: { id: "test-vision-model", url: "http://127.0.0.1:1/v1", npm: "@ai-sdk/openai-compatible" },
      name: "test-vision-model",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128_000, output: 32_000 },
      status: "active",
      options: {},
      headers: {},
      ...overrides,
    }) as Provider.Model

  test("file part with data URI survives serialization", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "file", data: IMAGE_DATA_URI, mediaType: "image/png", filename: "vision-test.png" },
          { type: "text", text: "请准确告诉我图片中的文字。" },
        ],
      },
    ] satisfies ModelMessage[]

    const result = ProviderTransform.message(msgs, dynamicModel(), {})
    const dumped = JSON.stringify(result)
    expect(dumped).not.toContain("ERROR: Cannot read")
    expect(dumped).not.toContain("does not support image input")
    // The image data itself must still be present in the outgoing message.
    expect(dumped).toContain("iVBORw0KGgoAAAANSUhEUg")
  })

  test("image part with data URI survives serialization", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "image", image: IMAGE_DATA_URI },
          { type: "text", text: "what is in the image?" },
        ],
      },
    ] satisfies ModelMessage[]

    const result = ProviderTransform.message(msgs, dynamicModel(), {})
    const dumped = JSON.stringify(result)
    expect(dumped).not.toContain("ERROR: Cannot read")
    expect(dumped).toContain("iVBORw0KGgoAAAANSUhEUg")
  })

  test("genuinely text-only model still degrades image to visible error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "image", image: IMAGE_DATA_URI },
          { type: "text", text: "what is in the image?" },
        ],
      },
    ] satisfies ModelMessage[]

    const textOnly = dynamicModel({
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        interleaved: false,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
      },
    })
    const result = ProviderTransform.message(msgs, textOnly, {})
    const dumped = JSON.stringify(result)
    // Upstream opencode behavior preserved for text-only models.
    expect(dumped).toContain("does not support image input")
    expect(dumped).not.toContain("iVBORw0KGgoAAAANSUhEUg")
  })
})
