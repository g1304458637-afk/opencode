import { describe, expect, test } from "bun:test"
import { collectRewardArrivals, parseRewardFeed, mergeRewardArrivals, type RewardArrival } from "./reward-arrival"
const now = Date.parse("2026-09-23T00:00:00Z")
const card = (id: string, quantity = 1): RewardArrival => ({
  id: `card:${id}`,
  type: "reset_card_received",
  quantity,
  occurredAt: new Date(now).toISOString(),
})

describe("reward arrival receipts", () => {
  test("initial history is silent; unseen receipt delivers once across polling and persisted restart", () => {
    const baseline = collectRewardArrivals({ accountId: "1", events: [card("old")] }, undefined, now)
    expect(baseline.arrivals).toEqual([])
    const fresh = collectRewardArrivals({ accountId: "1", events: [card("old"), card("new")] }, baseline.state, now)
    expect(fresh.arrivals.map((x) => x.id)).toEqual(["card:new"])
    expect(
      collectRewardArrivals(
        { accountId: "1", events: [card("new"), card("old")] },
        JSON.parse(JSON.stringify(fresh.state)),
        now,
      ).arrivals,
    ).toEqual([])
  })
  test("duplicate records do not count twice; stale and future records do not notify", () => {
    const state = { seen: {}, floor: now - 1000 }
    expect(collectRewardArrivals({ accountId: "1", events: [card("1"), card("1")] }, state, now).arrivals).toHaveLength(
      1,
    )
    expect(
      collectRewardArrivals(
        {
          accountId: "1",
          events: [
            { ...card("old"), occurredAt: new Date(now - 2000).toISOString() },
            { ...card("future"), occurredAt: new Date(now + 120000).toISOString() },
          ],
        },
        state,
        now,
      ).arrivals,
    ).toEqual([])
  })
  test("merge cards regardless of origin, keep immediate reset separate and subscription scoped", () => {
    const reset: RewardArrival = {
      id: "reset:1",
      type: "global_reset_received",
      quantity: 1,
      occurredAt: new Date(now).toISOString(),
      subscriptionId: 2,
    }
    expect(mergeRewardArrivals([card("1"), card("2", 3), reset])).toEqual([
      { ...card("2", 4), id: "card:1,card:2" },
      reset,
    ])
  })
  test("parses only typed user-scoped confirmed event contract, never a balance delta", () => {
    expect(parseRewardFeed({ reset_cards: { available: 99 } })).toBeUndefined()
    const parsed = parseRewardFeed({
      account_id: "1",
      events: [
        { id: "card:1", type: "reset_card_received", quantity: 3, occurred_at: new Date(now).toISOString() },
        { id: "reset:2", type: "global_reset_received", quantity: 1, occurred_at: new Date(now).toISOString() },
        { id: "card:3", type: "reset_card_received", quantity: -1, occurred_at: new Date(now).toISOString() },
      ],
    })
    expect(parsed?.events).toEqual([card("1", 3)])
  })
})
