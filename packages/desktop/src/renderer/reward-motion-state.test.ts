import { describe, expect, test } from "bun:test"
import { enqueueRewards, rewardEvents, rewardFrame, type RewardSnapshot } from "./reward-motion-state"
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
