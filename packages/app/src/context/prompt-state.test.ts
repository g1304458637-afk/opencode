import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptState, DEFAULT_PROMPT } from "./prompt-state"

describe("prompt state initialization", () => {
  test("initializes prompt text, cursor, and model together", () => {
    createRoot((dispose) => {
      const model = { providerID: "anthropic", modelID: "claude", variant: "high" }
      const prompt = createPromptState({ prompt: "hello", model })

      expect(prompt.current()).toEqual([{ type: "text", content: "hello", start: 0, end: 5 }])
      expect(prompt.cursor()).toBe(5)
      expect(prompt.model.current()).toEqual(model)
      expect(prompt.model.current()).not.toBe(model)
      dispose()
    })
  })

  test("uses the default prompt without initial values", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()

      expect(prompt.current()).toEqual(DEFAULT_PROMPT)
      expect(prompt.cursor()).toBeUndefined()
      expect(prompt.model.current()).toBeUndefined()
      dispose()
    })
  })
})

test("task skill selection survives composer reset, remains isolated, and respects explicit removal", () => {
  const first = createPromptState()
  const second = createPromptState()
  const skill = {
    id: `sk_${"a".repeat(64)}`,
    name: "Design",
    description: "",
    sourceType: "local" as const,
    repository: "fixture",
    path: "",
    revision: "b".repeat(64),
    contentHash: "b".repeat(64),
    managed: true,
  }
  first.skills.add(skill)
  expect(first.skills.current()).toEqual([skill])
  expect(second.skills.current()).toEqual([])
  first.skills.restore([skill], "original-task")
  expect(first.skills.origin()).toBe("original-task")
  first.skills.remove(skill.id)
  expect(first.skills.origin()).toBeUndefined()
  first.skills.add(skill)
  first.reset()
  expect(first.skills.current()).toEqual([skill])
  first.skills.remove(skill.id)
  first.reset()
  expect(first.skills.current()).toEqual([])
  expect(second.skills.current()).toEqual([])
})
