import { describe, expect, test } from "bun:test"
import { availableQuotaAfterReset, mucEase } from "./muc-reset-animation"

describe("MUC Harness: reset animation semantics (与 Website 同语义)", () => {
  test("available quota: 83% used → 17% available fills to 100", () => {
    expect(availableQuotaAfterReset(83)).toEqual({ from: 17, to: 100 })
  })

  test("available quota: exhausted (100% used) → 0% available fills to 100", () => {
    expect(availableQuotaAfterReset(100)).toEqual({ from: 0, to: 100 })
  })

  test("available quota: reset state (0% used) → starts at 100", () => {
    expect(availableQuotaAfterReset(0)).toEqual({ from: 100, to: 100 })
  })

  test("available quota: null usage treated as 0% used", () => {
    expect(availableQuotaAfterReset(null)).toEqual({ from: 100, to: 100 })
  })

  test("mucEase is monotonic and bounded (0..1)", () => {
    let prev = 0
    for (let i = 0; i <= 20; i++) {
      const v = mucEase(i / 20)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeLessThanOrEqual(1)
      prev = v
    }
    expect(mucEase(0)).toBe(0)
    expect(mucEase(1)).toBe(1)
  })
})
