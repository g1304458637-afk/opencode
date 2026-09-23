import { describe, expect, test } from "bun:test"
import type { MucSubscriptionStatus } from "../preload/types"
import { chargeFrame, quotaLevel, resetChargeTargets } from "./quota-energy-state"

function subscription(value: number, startedAt = "2026-09-22T00:00:00Z"): MucSubscriptionStatus {
  return {
    id: 1,
    groupId: 1,
    displayName: "Pro",
    quotaPolicy: "dual_window_v1",
    weeklyUsagePercent: 100 - value,
    shortWindow: { remainingPercent: value, startsAt: startedAt, resetsAt: null, exhausted: value === 0 },
    weeklyWindow: { remainingPercent: 80, startsAt: "2026-09-21T00:00:00Z", resetsAt: null, exhausted: false },
    usageStatus: "normal",
    expiresAt: "2099-01-01",
    paygFallback: false,
  }
}

describe("quota presentation reset detection", () => {
  test("opening, unchanged refresh, ordinary increase and decreasing usage never charge", () => {
    expect(resetChargeTargets(null, subscription(100))).toEqual([])
    expect(resetChargeTargets(subscription(30), subscription(30))).toEqual([])
    expect(resetChargeTargets(subscription(30), subscription(75))).toEqual([])
    expect(resetChargeTargets(subscription(75), subscription(30))).toEqual([])
  })
  test("server window rollover animates only the changed window to its actual value", () => {
    expect(resetChargeTargets(subscription(10), subscription(97, "2026-09-22T05:00:00Z"))).toEqual([
      { index: 0, from: 10, to: 97 },
    ])
  })
  test("confirmed card reset can animate without new timestamp but never fabricates 100", () => {
    expect(resetChargeTargets(subscription(10), subscription(95), true)).toEqual([{ index: 0, from: 10, to: 95 }])
    expect(resetChargeTargets(subscription(100), subscription(100), true)).toEqual([])
  })
  test("subscription switch, missing window and missing old epoch do not imply reset", () => {
    expect(resetChargeTargets(subscription(10), { ...subscription(100), id: 2 }, true)).toEqual([])
    expect(resetChargeTargets({ ...subscription(10), shortWindow: undefined }, subscription(100), true)).toEqual([])
    expect(resetChargeTargets(subscription(10, ""), subscription(100))).toEqual([])
  })
  test("legacy weekly reset keeps its own window semantics", () => {
    const old = { ...subscription(30), quotaPolicy: undefined, weeklyPeriodStartedAt: "2026-09-01T00:00:00Z" }
    const next = { ...old, weeklyUsagePercent: 0, weeklyPeriodStartedAt: "2026-09-08T00:00:00Z" }
    expect(resetChargeTargets(old, next)).toEqual([{ index: 0, from: 30, to: 100 }])
  })
  test("visual levels include boundaries and unknown data", () => {
    expect([100, 80, 79, 40, 39, 15, 14, 0, null, NaN].map(quotaLevel)).toEqual([
      "healthy",
      "healthy",
      "normal",
      "normal",
      "low",
      "low",
      "critical",
      "critical",
      "unknown",
      "unknown",
    ])
  })
  test("charge runs four bounded phases and always settles", () => {
    expect([0, 249, 250, 1299, 1300, 1649, 1650, 2199, 2200].map((ms) => chargeFrame(ms).phase)).toEqual([
      "awaken",
      "awaken",
      "charging",
      "charging",
      "fullPulse",
      "fullPulse",
      "settle",
      "settle",
      "idle",
    ])
    expect(chargeFrame(250).progress).toBe(0)
    expect(chargeFrame(1300).progress).toBe(1)
  })
})
