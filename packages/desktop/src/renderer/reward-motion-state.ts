import type { RewardArrival } from "../shared/reward-arrival"
import type { MucUsageSnapshot } from "../preload/types"
import { quotaReadings } from "./quota-energy-state"

export const rewardMotionTokens = {
  duration: { FULL_RESET: 2600, RESET_CARD_GRANTED: 2300 },
  gap: 200,
  toast: 6000,
  restore: [650, 1150],
  count: [1950, 2130],
  tiers: {
    FULL_RESET: { tier: "S+", priority: 100 },
    RESET_CARD_GRANTED: { tier: "S", priority: 80 },
    STANDARD: { tier: "B", priority: 20 },
  },
} as const
export type RewardSnapshot = {
  subscriptionId?: number
  policy?: string
  quota: (number | null)[]
  cards: number | null
}
export type RewardEvent = {
  id: string
  ids: string[]
  type: "FULL_RESET" | "RESET_CARD_GRANTED"
  createdAt: string
  source: "usage"
  payload: { before: RewardSnapshot; after: RewardSnapshot; arrival: RewardArrival }
}
export function rewardSnapshot(usage: MucUsageSnapshot | null): RewardSnapshot {
  return {
    subscriptionId: usage?.subscriptionStatus?.id,
    policy: usage?.subscriptionStatus?.quotaPolicy,
    quota: quotaReadings(usage?.subscriptionStatus).map((x) => x.value),
    cards: usage?.resetCardsAvailable ?? null,
  }
}
export function rewardEvents(arrivals: RewardArrival[], before: RewardSnapshot, after: RewardSnapshot): RewardEvent[] {
  return arrivals.flatMap((arrival) => {
    const reset = arrival.type === "global_reset_received"
    // Never infer a balance from a receipt quantity. The successful usage snapshot is authoritative.
    if (
      reset &&
      (arrival.subscriptionId !== after.subscriptionId || !after.quota.length || after.quota.some((n) => n === null))
    )
      return []
    if (!reset && after.cards === null) return []
    const comparable = before.subscriptionId === after.subscriptionId && before.policy === after.policy
    return [
      {
        id: arrival.id,
        ids: [arrival.id],
        type: reset ? "FULL_RESET" : "RESET_CARD_GRANTED",
        createdAt: arrival.occurredAt,
        source: "usage",
        payload: { before: comparable ? before : { ...after, cards: before.cards }, after, arrival },
      } satisfies RewardEvent,
    ]
  })
}
export function enqueueRewards(queue: RewardEvent[], incoming: RewardEvent[], seen: Set<string>) {
  const result = [...queue]
  for (const event of incoming) {
    if (event.ids.some((id) => seen.has(id))) continue
    event.ids.forEach((id) => seen.add(id))
    while (seen.size > 4096) seen.delete(seen.values().next().value!)
    const index = result.findIndex(
      (item) => item.type === event.type && item.payload.after.subscriptionId === event.payload.after.subscriptionId,
    )
    if (index < 0) {
      result.push(event)
      continue
    }
    const previous = result[index]
    result[index] = {
      ...event,
      id: previous.id,
      ids: [...previous.ids, ...event.ids],
      payload: {
        ...event.payload,
        before: previous.payload.before,
        arrival: {
          ...event.payload.arrival,
          quantity: previous.payload.arrival.quantity + event.payload.arrival.quantity,
        },
      },
    }
  }
  return result.sort((a, b) => rewardMotionTokens.tiers[b.type].priority - rewardMotionTokens.tiers[a.type].priority)
}
const clamp = (n: number) => Math.max(0, Math.min(1, n))
export function rewardProgress(time: number, range: readonly [number, number], reduced = false) {
  const t = clamp((time - range[0]) / (range[1] - range[0]))
  return reduced ? Number(t >= 0.5) : 1 - (1 - t) ** 3
}
export function rewardFrame(event: RewardEvent, time: number, reduced = false) {
  const reset = event.type === "FULL_RESET"
  const phases = reset
    ? ([
        [0, "prepare"],
        [80, "energy_build"],
        [650, "restore"],
        [1150, "impact"],
        [1750, "settle"],
        [2400, "confirm"],
      ] as const)
    : ([
        [0, "reveal"],
        [160, "card_form"],
        [300, "card_flip"],
        [800, "highlight"],
        [1100, "celebrate"],
        [1450, "transfer"],
        [1950, "land"],
        [2130, "count_update"],
        [2200, "confirm"],
      ] as const)
  const phase = [...phases].reverse().find(([at]) => time >= at)?.[1] ?? phases[0][1]
  const progress = rewardProgress(time, rewardMotionTokens.restore, reduced)
  return {
    phase,
    quota: event.payload.after.quota.map((value, i) => {
      const old = event.payload.before.quota[i]
      return !reset || value === null || old == null
        ? value
        : Math.max(0, Math.min(100, old + (value - old) * progress))
    }),
    cards:
      reset || event.payload.before.cards === null
        ? event.payload.after.cards
        : Math.round(
            event.payload.before.cards +
              ((event.payload.after.cards ?? 0) - event.payload.before.cards) *
                rewardProgress(time, rewardMotionTokens.count, reduced),
          ),
  }
}
