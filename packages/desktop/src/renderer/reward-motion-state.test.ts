import { describe, expect, test } from "bun:test"
import {
  enqueueRewards,
  rewardEvents,
  rewardFrame,
  resetCardEvent,
  rewardMotionTokens,
  type RewardSnapshot,
} from "./reward-motion-state"
const before: RewardSnapshot = { subscriptionId: 1, policy: "dual_window_v1", quota: [20, 41], cards: 0 }
const after: RewardSnapshot = { ...before, quota: [100, 100], cards: 1 }
const reset = {
  id: "reset:1",
  type: "global_reset_received" as const,
  quantity: 1,
  occurredAt: new Date().toISOString(),
  subscriptionId: 1,
}
const card = { id: "card:1", type: "reset_card_received" as const, quantity: 1, occurredAt: new Date().toISOString() }
describe("reward presentation contract", () => {
  for (const old of [20, 95, 100])
    test(`${old} to 100 uses only snapshot interpolation`, () => {
      const [event] = rewardEvents([reset], { ...before, quota: [old, 41] }, after)
      expect(rewardFrame(event, 0).quota).toEqual([old, 41])
      expect(rewardFrame(event, 850).quota[0]).toBeGreaterThanOrEqual(old)
      expect(rewardFrame(event, 1150).quota).toEqual([100, 100])
    })
  test("partial reset and non-100 targets are preserved", () => {
    const [event] = rewardEvents([reset], before, { ...after, quota: [83, 41] })
    expect(rewardFrame(event, 1150).quota).toEqual([83, 41])
    expect(rewardFrame(event, 850).quota[1]).toBe(41)
  })
  for (const n of [0, 1, 5])
    test(`card ${n} to ${n + 1} lands then counts`, () => {
      const [event] = rewardEvents([card], { ...before, cards: n }, { ...after, cards: n + 1 })
      expect(rewardFrame(event, 1900).cards).toBe(n)
      expect(rewardFrame(event, 2130).cards).toBe(n + 1)
    })
  test("priority, duplicates and burst aggregation", () => {
    const seen = new Set<string>()
    const events = rewardEvents([card, card, { ...card, id: "card:2" }, { ...card, id: "card:3" }, reset], before, {
      ...after,
      cards: 3,
    })
    const queue = enqueueRewards([], events, seen)
    expect(queue.map((e) => e.type)).toEqual(["FULL_RESET", "RESET_CARD_GRANTED"])
    expect(queue[1].payload.arrival.quantity).toBe(3)
    expect(queue[1].payload.after.cards).toBe(3)
    expect(enqueueRewards(queue, events, seen)).toEqual(queue)
  })
  test("unknown balance and wrong subscription cannot claim success", () => {
    expect(rewardEvents([reset], before, { ...after, subscriptionId: 2 })).toEqual([])
    expect(rewardEvents([reset], before, { ...after, quota: [null, 100] })).toEqual([])
    expect(rewardEvents([card], before, { ...after, cards: null })).toEqual([])
  })
  test("unknown old state never invents a change", () => {
    const [event] = rewardEvents([reset], { quota: [], cards: null }, after)
    expect(rewardFrame(event, 0).quota).toEqual(after.quota)
    const [grant] = rewardEvents([card], { quota: [], cards: null }, after)
    expect(rewardFrame(grant, 0).cards).toBe(1)
  })
  test("reduced motion changes to exact server value without counting", () => {
    const [event] = rewardEvents([reset], before, after)
    expect(rewardFrame(event, 700, true).quota).toEqual(before.quota)
    expect(rewardFrame(event, 950, true).quota).toEqual(after.quota)
  })
})

describe("confirmed reset-card redemption", () => {
  const old = { ...before, cards: 3 }
  const restored = { ...after, quota: [80, 90], cards: 2 }
  test("card consumption and both quota windows follow the confirmed snapshot", () => {
    const event = resetCardEvent("operation-1", 1, old, restored)!
    expect(event.type).toBe("RESET_CARD_USED")
    expect(event.source).toBe("redemption")
    expect(rewardFrame(event, 0)).toEqual({ phase: "draw", quota: old.quota, cards: 3 })
    expect(rewardFrame(event, 799).quota).toEqual(old.quota)
    expect(rewardFrame(event, 1000).quota[0]).toBeGreaterThan(20)
    expect(rewardFrame(event, 1000).quota[0]).toBeLessThan(80)
    expect(rewardFrame(event, 900).cards).toBe(2)
    expect(rewardFrame(event, 1450)).toEqual({ phase: "settle", quota: [80, 90], cards: 2 })
    expect(rewardMotionTokens.duration.RESET_CARD_USED / 0.5).toBe(4200)
  })
  test("unknown or changed subscription state cannot authorize an effect", () => {
    for (const value of [
      { ...restored, subscriptionId: 2 },
      { ...restored, policy: "legacy" },
      { ...restored, quota: [] },
      { ...restored, quota: [null, 90] },
      { ...restored, quota: [NaN, 90] },
      { ...restored, cards: null },
      { ...restored, cards: -1 },
    ])
      expect(resetCardEvent("operation", 1, old, value)).toBeUndefined()
    expect(resetCardEvent("", 1, old, restored)).toBeUndefined()
  })
  test("same operation is deduplicated, distinct uses retain separate receipts", () => {
    const seen = new Set<string>()
    const first = resetCardEvent("operation-1", 1, old, restored)!
    const second = resetCardEvent("operation-2", 1, restored, { ...restored, cards: 1 })!
    const queue = enqueueRewards([], [first, first, second], seen)
    expect(queue).toHaveLength(2)
    expect(queue.map((event) => event.payload.arrival.quantity)).toEqual([1, 1])
    expect(enqueueRewards(queue, [first, second], seen)).toEqual(queue)
  })
  test("concurrent grants and already-full quota never fabricate a decrement or refill", () => {
    const full = { ...old, quota: [100, 100] }
    const event = resetCardEvent("operation-1", 1, full, { ...full, cards: 5 })!
    expect(rewardFrame(event, 2100).cards).toBe(5)
    expect(rewardFrame(event, 1000).quota).toEqual([100, 100])
  })
  test("reduced motion snaps to server state instead of counting", () => {
    const event = resetCardEvent("operation-1", 1, old, restored)!
    expect(rewardFrame(event, 800, true).quota).toEqual(old.quota)
    expect(rewardFrame(event, 1200, true).quota).toEqual(restored.quota)
    expect(rewardFrame(event, 900, true).cards).toBe(2)
  })
})
