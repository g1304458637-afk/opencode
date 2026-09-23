import type { MucSubscriptionStatus } from "../preload/types"

export type QuotaLevel = "unknown" | "healthy" | "normal" | "low" | "critical"
export type ChargePhase = "idle" | "awaken" | "charging" | "fullPulse" | "settle"
export type QuotaReading = { value: number | null; startedAt: string | null }

export function quotaLevel(value: number | null | undefined): QuotaLevel {
  if (value == null || !Number.isFinite(value)) return "unknown"
  if (value >= 80) return "healthy"
  if (value >= 40) return "normal"
  if (value >= 15) return "low"
  return "critical"
}

export function quotaReadings(sub: MucSubscriptionStatus | null | undefined): QuotaReading[] {
  if (!sub) return []
  if (sub.quotaPolicy === "dual_window_v1")
    return [sub.shortWindow, sub.weeklyWindow].map((window) => ({
      value: window?.remainingPercent ?? null,
      startedAt: window?.startsAt ?? null,
    }))
  return [
    {
      value: sub.weeklyUsagePercent == null ? null : 100 - sub.weeklyUsagePercent,
      startedAt: sub.weeklyPeriodStartedAt ?? null,
    },
  ]
}

// A higher balance alone is not proof of reset (refunds and corrections also increase it).
export function resetChargeTargets(
  before: MucSubscriptionStatus | null | undefined,
  after: MucSubscriptionStatus | null | undefined,
  confirmedReset = false,
) {
  if (!before || !after || before.id !== after.id || before.quotaPolicy !== after.quotaPolicy) return []
  const previous = quotaReadings(before)
  return quotaReadings(after).flatMap((next, index) => {
    const old = previous[index]
    if (
      !old ||
      old.value == null ||
      next.value == null ||
      !Number.isFinite(old.value) ||
      !Number.isFinite(next.value) ||
      next.value <= old.value
    )
      return []
    const advanced = old.startedAt && next.startedAt && Date.parse(next.startedAt) > Date.parse(old.startedAt)
    if (!confirmedReset && !advanced) return []
    return [{ index, from: old.value, to: next.value }]
  })
}

export function chargeFrame(elapsed: number) {
  if (elapsed < 250) return { phase: "awaken" as const, progress: 0 }
  if (elapsed < 1300) {
    const t = (elapsed - 250) / 1050
    return { phase: "charging" as const, progress: 1 - (1 - t) ** 3 }
  }
  if (elapsed < 1650) return { phase: "fullPulse" as const, progress: 1 }
  if (elapsed < 2200) return { phase: "settle" as const, progress: 1 }
  return { phase: "idle" as const, progress: 1 }
}
