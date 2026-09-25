export const rewardTypes = ["reset_card_received", "global_reset_received"] as const
export type RewardType = (typeof rewardTypes)[number]
export type RewardArrival = {
  id: string
  type: RewardType
  quantity: number
  occurredAt: string
  subscriptionId?: number
}
export type RewardFeed = { accountId: string; events: RewardArrival[] }
export type RewardReceiptState = { seen: Record<string, number>; floor: number }
const WEEK = 7 * 24 * 60 * 60 * 1000

export function parseRewardFeed(input: unknown): RewardFeed | undefined {
  if (
    !input ||
    typeof input !== "object" ||
    !("account_id" in input) ||
    typeof input.account_id !== "string" ||
    !/^\d{1,20}$/.test(input.account_id) ||
    !("events" in input) ||
    !Array.isArray(input.events)
  )
    return undefined
  const events = input.events.slice(0, 100).flatMap((raw): RewardArrival[] => {
    if (!raw || typeof raw !== "object") return []
    if (
      typeof raw.id !== "string" ||
      !/^(card|reset):[\w-]{1,100}$/.test(raw.id) ||
      !rewardTypes.includes(raw.type) ||
      !Number.isSafeInteger(raw.quantity) ||
      raw.quantity < 1 ||
      raw.quantity > 1000 ||
      typeof raw.occurred_at !== "string" ||
      !Number.isFinite(Date.parse(raw.occurred_at))
    )
      return []
    const isReset = raw.type === "global_reset_received"
    if (isReset && (!Number.isSafeInteger(raw.subscription_id) || raw.subscription_id <= 0)) return []
    return [
      {
        id: raw.id,
        type: raw.type,
        quantity: raw.quantity,
        occurredAt: raw.occurred_at,
        ...(isReset ? { subscriptionId: raw.subscription_id } : {}),
      },
    ]
  })
  return { accountId: input.account_id, events }
}

// Persisted by the main process before delivery: reloads and other windows cannot replay receipts.
// The first successful feed is a silent baseline, not a replay of account history.
export function collectRewardArrivals(feed: RewardFeed, previous: RewardReceiptState | undefined, now: number) {
  const seen = { ...previous?.seen }
  const floor = Math.max(previous?.floor ?? 0, now - WEEK)
  const arrivals: RewardArrival[] = []
  for (const event of [...feed.events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))) {
    const at = Date.parse(event.occurredAt)
    if (at < floor || at > now + 60_000 || Object.hasOwn(seen, event.id)) continue
    seen[event.id] = at
    if (previous) arrivals.push(event)
  }
  const entries = Object.entries(seen)
    .filter(([, at]) => at >= floor)
    .sort((a, b) => b[1] - a[1])
  const cutoff = entries.length > 4096 ? Math.max(floor, entries[4096][1] + 1) : floor
  return {
    arrivals,
    state: { seen: Object.fromEntries(entries.filter(([, at]) => at >= cutoff).slice(0, 4096)), floor: cutoff },
  }
}

export function isSystemReward(event: Pick<RewardArrival, "type">) {
  return event.type === "global_reset_received"
}

export function mergeRewardArrivals(events: RewardArrival[]): RewardArrival[] {
  const groups = new Map<string, RewardArrival>()
  for (const event of events) {
    const key = isSystemReward(event) ? `${event.type}:${event.subscriptionId}` : "card"
    const previous = groups.get(key)
    const quantity = (previous?.quantity ?? 0) + event.quantity
    groups.set(key, { ...event, id: previous ? `${previous.id},${event.id}` : event.id, quantity, type: event.type })
  }
  return [...groups.values()]
}

export function parseRewardReceiptState(input: unknown): RewardReceiptState | undefined {
  if (
    !input ||
    typeof input !== "object" ||
    !("floor" in input) ||
    typeof input.floor !== "number" ||
    !Number.isFinite(input.floor) ||
    !("seen" in input) ||
    !input.seen ||
    typeof input.seen !== "object" ||
    Array.isArray(input.seen)
  )
    return undefined
  const seen = Object.fromEntries(
    Object.entries(input.seen).filter(
      ([id, at]) => /^(card|reset):[\w-]{1,100}$/.test(id) && typeof at === "number" && Number.isFinite(at),
    ),
  )
  return { floor: input.floor, seen }
}
