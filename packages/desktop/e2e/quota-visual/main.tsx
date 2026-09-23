// Dev-only fixture: mounts the production component; IPC substitutes never enter the desktop build.
import { render } from "solid-js/web"
import { collectRewardArrivals, type RewardArrival, type RewardReceiptState } from "../../src/shared/reward-arrival"
import { MucStatus } from "../../src/renderer/muc-status"
import type { MucUsageSnapshot, ElectronAPI } from "../../src/preload/types"
import "@opencode-ai/app/index.css"
import "./preview.css"

let value = Number(new URLSearchParams(location.search).get("quota") ?? 100)
let week = value
let epoch = "2026-09-23T00:00:00Z"
let cards = 3
let stale = false
let receipts: RewardArrival[] = []
let receiptState: RewardReceiptState | undefined
let nextReceipt = 0
function snapshot(): MucUsageSnapshot {
  return {
    planName: "套餐 1",
    mode: "subscription",
    remaining: null,
    unit: "",
    todayCost: 0,
    todayRequests: 0,
    totalCost: 0,
    totalRequests: 0,
    wallet: null,
    resetCardsAvailable: cards,
    rateWindows: [],
    topModels: [],
    subscriptionStatus: {
      id: 1,
      groupId: 1,
      displayName: "套餐 1",
      quotaPolicy: "dual_window_v1",
      weeklyUsagePercent: 100 - week,
      shortWindow: {
        remainingPercent: value,
        startsAt: epoch,
        resetsAt: "2026-09-23T06:45:00+08:00",
        exhausted: value === 0,
      },
      weeklyWindow: {
        remainingPercent: week,
        startsAt: epoch,
        resetsAt: "2026-09-30T01:45:00+08:00",
        exhausted: week === 0,
      },
      usageStatus: value < 15 ? "near_limit" : "normal",
      expiresAt: "2026-10-22T20:03:00+08:00",
      paygFallback: false,
    },
  }
}
const api = {
  mucGetUsage: async () => {
    if (stale) return { ok: false, error: "unavailable" }
    const result = collectRewardArrivals({ accountId: "1", events: receipts }, receiptState, Date.now())
    receiptState = result.state
    return { ok: true, usage: { ...snapshot(), rewardArrivals: result.arrivals } }
  },
  mucGetUpdate: async () => ({ available: false, status: "up-to-date", localVersion: "2.0.7" }),
  storeGet: async () => null,
  storeSet: async () => {},
  mucResetCard: async () => {
    value = week = 100
    cards -= 1
    epoch = new Date().toISOString()
    return { ok: true, operationId: "visual-preview", weeklyPeriodEndsAt: "2026-09-30T01:45:00+08:00" }
  },
  mucAcknowledgeReset: async () => {},
  mucOpenAccount: async () => {},
  mucOpenPricing: async () => {},
  mucOpenDownloadPage: async () => {},
}
Object.defineProperty(window, "api", { value: api as unknown as ElectronAPI })
function refresh() {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".quota-panel button")].find(
    (button) => button.textContent?.trim() === "刷新",
  )
  if (!button) document.querySelector<HTMLButtonElement>(".quota-orb-button")?.click()
  requestAnimationFrame(() =>
    [...document.querySelectorAll<HTMLButtonElement>(".quota-panel button")]
      .find((button) => button.textContent?.trim() === "刷新")
      ?.click(),
  )
}
render(
  () => (
    <>
      <main class="preview-stage">
        <header>
          MUCode <span>新会话</span>
        </header>
        <p class="preview-message">你好！有什么可以帮你的吗？</p>
        <textarea class="preview-composer" placeholder="问我任何事情…" aria-label="Chat input" />
      </main>
      <aside class="preview-controls" aria-label="Development visual controls">
        <strong>本地演示 · 不调用真实 API</strong>
        {[1, 3].map((quantity) => (
          <button
            onClick={() => {
              cards += quantity
              receipts.push({
                id: `card:preview-${++nextReceipt}`,
                type: "reset_card_received",
                quantity,
                occurredAt: new Date().toISOString(),
              })
              refresh()
            }}
          >
            收到 {quantity} 张重置卡
          </button>
        ))}
        <button
          onClick={() => {
            value = week = 100
            epoch = new Date().toISOString()
            receipts.push({
              id: `reset:preview-${++nextReceipt}`,
              type: "global_reset_received",
              quantity: 1,
              occurredAt: epoch,
              subscriptionId: 1,
            })
            refresh()
          }}
        >
          立即重置
        </button>
        {[100, 75, 30, 10].map((amount) => (
          <button
            onClick={() => {
              value = week = amount
              stale = false
              refresh()
            }}
          >
            {amount}%
          </button>
        ))}
        <button
          onClick={() => {
            value = week = 100
            epoch = new Date(Date.parse(epoch) + 18_000_000).toISOString()
            stale = false
            refresh()
          }}
        >
          Reset preview
        </button>
        <button
          onClick={() => {
            stale = !stale
            refresh()
          }}
        >
          Toggle stale
        </button>
      </aside>
      <MucStatus />
    </>
  ),
  document.getElementById("root")!,
)
