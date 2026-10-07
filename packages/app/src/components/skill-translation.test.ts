import { expect, test } from "bun:test"
import { scheduleTranslation, translationError } from "./skill-translation"

test("translation work is bounded across views and cancelled queued work does not call the model", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let started = 0
  let active = 0
  let peak = 0
  let cancelled = false
  const work = async () => {
    started++
    active++
    peak = Math.max(peak, active)
    await gate
    active--
    return "中文"
  }
  const first = scheduleTranslation(work)
  const second = scheduleTranslation(work)
  const third = scheduleTranslation(work, () => !cancelled).catch((cause) => cause.message)
  expect(started).toBe(2)
  cancelled = true
  release()
  expect(await Promise.all([first, second, third])).toEqual(["中文", "中文", "TRANSLATION_CANCELLED"])
  expect(started).toBe(2)
  expect(peak).toBe(2)
  expect(await scheduleTranslation(async () => "恢复")).toBe("恢复")
})

test("translation failures have actionable reasons without exposing provider messages", () => {
  expect(translationError({ code: "MODEL_UNAVAILABLE" })).toBe("model")
  expect(translationError(new TypeError("Failed to fetch"))).toBe("network")
  expect(translationError({ code: "HASH_MISMATCH" })).toBe("changed")
  expect(translationError(new Error("generateObject: invalid JSON"))).toBe("invalid")
  expect(translationError(new Error("Provider returned sensitive debug information"))).toBe("failed")
})
