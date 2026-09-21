import { describe, expect, test } from "bun:test"
import { parseMucUsage } from "./usage"

// Phase 5 —— /v1/usage 解析器合同测试：
// 新合同（wallet/reset_cards/subscription_status）优先，缺失时回退 legacy。

function newContractBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "unrestricted",
    isValid: true,
    planName: "Pro",
    unit: "USD",
    subscription_status: {
      id: 123,
      group_id: 13,
      display_name: "Pro",
      weekly_usage_percent: 63,
      usage_status: "normal",
      weekly_period_started_at: "2026-09-13T08:00:00Z",
      weekly_period_ends_at: "2026-09-27T08:00:00Z",
      expires_at: "2026-10-20T00:00:00Z",
      payg_fallback: false,
    },
    wallet: { balance: "12.48000000", canonical_currency: "USD" },
    reset_cards: { available: 1 },
    // legacy 字段同时存在（新客户端必须优先新合同）
    remaining: 7.52,
    subscription: { weekly_usage_usd: 6.3, weekly_limit_usd: 10 },
    usage: { today: { cost: 1.5, requests: 4 }, total: { cost: 9, requests: 20 } },
    ...over,
  }
}

describe("MUC Harness: parseMucUsage status contract", () => {
  test("new contract: wallet + subscription_status + reset_cards parsed", () => {
    const snap = parseMucUsage(newContractBody())
    expect(snap.wallet).toEqual({ balance: "12.48000000", canonicalCurrency: "USD" })
    expect(snap.subscriptionStatus).not.toBeNull()
    expect(snap.subscriptionStatus!.displayName).toBe("Pro")
    expect(snap.subscriptionStatus!.weeklyUsagePercent).toBe(63)
    expect(snap.subscriptionStatus!.usageStatus).toBe("normal")
    expect(snap.subscriptionStatus!.weeklyPeriodEndsAt).toBe("2026-09-27T08:00:00Z")
    expect(snap.subscriptionStatus!.expiresAt).toBe("2026-10-20T00:00:00Z")
    expect(snap.subscriptionStatus!.paygFallback).toBe(false)
    expect(snap.resetCardsAvailable).toBe(1)
    // 新合同优先：legacy remaining 不得覆盖归一化结果（订阅剩余不是钱包）
    expect(snap.mode).toBe("subscription")
    expect(snap.planName).toBe("Pro")
  })

  test("PAYG: wallet present, subscription_status absent", () => {
    const snap = parseMucUsage({
      mode: "unrestricted",
      planName: "钱包余额",
      unit: "USD",
      remaining: 100,
      balance: 100,
      wallet: { balance: "100.00000000", canonical_currency: "USD" },
      reset_cards: { available: 0 },
      usage: { today: { cost: 0 }, total: { cost: 0 } },
    })
    expect(snap.wallet?.balance).toBe("100.00000000")
    expect(snap.resetCardsAvailable).toBe(0)
    expect(snap.subscriptionStatus).toBeNull()
    expect(snap.mode).toBe("wallet")
  })

  test("legacy fallback: old server response still parses", () => {
    const snap = parseMucUsage({
      mode: "unrestricted",
      planName: "Pro",
      unit: "USD",
      remaining: 7.52,
      subscription: { weekly_usage_usd: 6.3, weekly_limit_usd: 10 },
      usage: { today: { cost: 0 }, total: { cost: 0 } },
    })
    expect(snap.wallet).toBeNull()
    expect(snap.subscriptionStatus).toBeNull()
    expect(snap.resetCardsAvailable).toBeNull()
    expect(snap.remaining).toBe(7.52)
    expect(snap.mode).toBe("subscription")
  })

  test("new preferred over legacy when both present", () => {
    const snap = parseMucUsage(newContractBody())
    // legacy remaining（订阅剩余 USD）不再进入 snapshot.remaining
    expect(snap.remaining).toBeNull()
    // 钱包来自新合同 wallet 对象
    expect(snap.wallet?.balance).toBe("12.48000000")
  })

  test("unmetered: weekly_usage_percent null, status unmetered", () => {
    const body = newContractBody()
    ;(body.subscription_status as Record<string, unknown>).weekly_usage_percent = null
    ;(body.subscription_status as Record<string, unknown>).usage_status = "unmetered"
    const snap = parseMucUsage(body)
    expect(snap.subscriptionStatus!.weeklyUsagePercent).toBeNull()
    expect(snap.subscriptionStatus!.usageStatus).toBe("unmetered")
  })
})

test("legacy wallet, missing fields, malformed numbers and envelopes degrade safely", () => {
  expect(parseMucUsage({ balance: 3.25, mode: "unrestricted", planName: "钱包余额" }).wallet?.balance).toBe("3.25000000")
  for (const input of [null, [], "bad", 3, {}, { wallet: { balance: "NaN" } }]) {
    const parsed = parseMucUsage(input)
    expect(parsed.mode).toBe("unknown")
    expect(parsed.subscriptionStatus).toBeNull()
    expect(parsed.wallet).toBeNull()
  }
  expect(parseMucUsage({ data: newContractBody() }).wallet?.balance).toBe("12.48000000")
  for (const percent of [99, 100, null]) {
    const body = newContractBody()
    ;(body.subscription_status as Record<string, unknown>).weekly_usage_percent = percent
    expect(parseMucUsage(body).subscriptionStatus?.weeklyUsagePercent).toBe(percent)
  }
})
