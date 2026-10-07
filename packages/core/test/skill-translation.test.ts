import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SkillTranslation } from "../src/skill/translation"

test("translation cache is content-addressed, reused, and upgraded when full markdown is requested", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kcode-skill-translation-"))
  let generated = 0
  const hash = "a".repeat(64)
  const summary = () =>
    Effect.sync(() => {
      generated++
      return { name: "Frontend", description: "Build web pages" }
    })
  try {
    const first = await Effect.runPromise(SkillTranslation.cached(root, hash, false, summary))
    const repeated = await Effect.runPromise(SkillTranslation.cached(root, hash, false, summary))
    expect(repeated).toEqual(first)
    expect(generated).toBe(1)

    const full = await Effect.runPromise(
      SkillTranslation.cached(root, hash, true, () =>
        Effect.sync(() => {
          generated++
          return { name: "Changed name", description: "Changed description", skillMarkdown: "# 中文技能" }
        }),
      ),
    )
    const fullAgain = await Effect.runPromise(SkillTranslation.cached(root, hash, true, summary))
    expect(full.name).toBe("Frontend")
    expect(full.description).toBe("Build web pages")
    expect(full.skillMarkdown).toBe("# 中文技能")
    expect(fullAgain).toEqual(full)
    expect(generated).toBe(2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
