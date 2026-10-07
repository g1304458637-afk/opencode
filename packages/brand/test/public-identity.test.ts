import { describe, expect, test } from "bun:test"
import { BRANDS, publicBrandMessages, publicBrandText } from "../src/index"

describe("HUBU presentation identity", () => {
  test("brands owned templates without changing placeholders or technical identifiers", () => {
    const messages = publicBrandMessages(
      { title: "OpenCode: {{name}}", provider: "Sub2API", "sub2api.id": "Open Code" },
      BRANDS.hubu,
    )
    expect(messages).toEqual({ title: "HUBU AI: {{name}}", provider: "HUBU AI", "sub2api.id": "HUBU AI" })
    expect(messages.title.replace("{{name}}", "OpenCode repo")).toBe("HUBU AI: OpenCode repo")
    expect(publicBrandText("opencode.json ~/.config/opencode/ @opencode-ai/sdk hubu HUBUCode", BRANDS.hubu)).toBe(
      "opencode.json ~/.config/opencode/ @opencode-ai/sdk hubu HUBUCode",
    )
    expect(publicBrandText("KCode / K AI / MUCode / MUC", BRANDS.hubu)).toBe("HUBU AI / HUBU AI / HUBU AI / HUBU AI")
  })

  test("preserves MUC and upstream presentation", () => {
    const messages = { title: "OpenCode uses Sub2API" }
    for (const brand of [BRANDS.muc, BRANDS.opencode]) {
      expect(publicBrandMessages(messages, brand)).toBe(messages)
      expect(publicBrandText(messages.title, brand)).toBe(messages.title)
    }
  })

  test("owned help links use the existing HUBU endpoint", () => {
    expect(publicBrandText("https://opencode.ai/docs", BRANDS.hubu)).toBe("https://hubu.wuxuexi.top/hubu")
  })
})
