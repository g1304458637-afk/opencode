import { render } from "solid-js/web"
import { createSignal } from "solid-js"
import { MucStatus } from "../../src/renderer/muc-status"
import { resolveBrand } from "../../../brand/src/index"
import type { MucUsageSnapshot } from "../../src/preload/types"
import type { RewardArrival } from "../../src/shared/reward-arrival"
import "./style.css"

// Isolated development entry. No gateway, credentials, server writes or production import.
if (!import.meta.env.DEV) throw new Error("Reward QA requires development mode")
const windowQuota = (value: number) => ({
  remainingPercent: value,
  startsAt: "2026-09-29T00:00:00Z",
  resetsAt: "2026-09-30T00:00:00Z",
  exhausted: value === 0,
})
let sequence = 0
let snapshot: MucUsageSnapshot = {
  planName: "Pro",
  remaining: null,
  unit: "USD",
  mode: "subscription",
  todayCost: 0,
  todayRequests: 0,
  totalCost: 0,
  totalRequests: 0,
  wallet: null,
  rateWindows: [],
  topModels: [],
  resetCardsAvailable: 0,
  subscriptionStatus: {
    id: 123,
    groupId: 13,
    displayName: "Pro",
    quotaPolicy: "dual_window_v1",
    shortWindow: windowQuota(20),
    weeklyWindow: windowQuota(41),
    weeklyUsagePercent: 59,
    usageStatus: "normal",
    expiresAt: "2026-12-31T00:00:00Z",
    paygFallback: false,
  },
}
let offline = false
let events: RewardArrival[] = []
let previousEvents: RewardArrival[] = []
Object.defineProperty(window, "api", {
  value: {
    storeGet: async (_store: string, key: string) =>
      key === "language" ? JSON.stringify({ locale: "zh" }) : undefined,
    storeSet: async () => {},
    mucGetUpdate: async () => ({ available: false, status: "current", localVersion: "2.1.0 QA" }),
    mucGetUsage: async () => {
      const rewardArrivals = events
      events = []
      return offline
        ? { ok: false, error: "unavailable" }
        : { ok: true, usage: structuredClone({ ...snapshot, rewardArrivals }) }
    },
    mucOpenAccount: async () => {},
    mucOpenDownloadPage: async () => {},
    mucOpenPricing: async () => {},
    mucAcknowledgeReset: async () => {},
    mucResetCard: async () => {
      if (!snapshot.resetCardsAvailable) return { ok: false }
      snapshot.resetCardsAvailable--
      snapshot.subscriptionStatus!.shortWindow = windowQuota(100)
      snapshot.subscriptionStatus!.weeklyWindow = windowQuota(100)
      return { ok: true, operationId: `fixture-use-${++sequence}` }
    },
  },
})
function App() {
  const [oldShort, setOldShort] = createSignal(20),
    [newShort, setNewShort] = createSignal(100)
  const [oldWeek, setOldWeek] = createSignal(41),
    [newWeek, setNewWeek] = createSignal(100)
  const [oldCards, setOldCards] = createSignal(0),
    [newCards, setNewCards] = createSignal(1)
  const refresh = () => window.dispatchEvent(new Event("reward-qa-refresh"))
  const prepare = () => {
    snapshot = {
      ...snapshot,
      resetCardsAvailable: oldCards(),
      subscriptionStatus: {
        ...snapshot.subscriptionStatus!,
        shortWindow: windowQuota(oldShort()),
        weeklyWindow: windowQuota(oldWeek()),
      },
    }
    refresh()
  }
  const trigger = (type: "reset" | "card" | "both" | "triple") => {
    const card = () => ({
      id: `card:qa-${++sequence}`,
      type: "reset_card_received" as const,
      quantity: type === "triple" ? 1 : Math.max(1, newCards() - oldCards()),
      occurredAt: new Date().toISOString(),
    })
    events = type === "reset" ? [] : type === "triple" ? [card(), card(), card()] : [card()]
    if (type === "reset" || type === "both")
      events.push({
        id: `reset:qa-${++sequence}`,
        type: "global_reset_received",
        quantity: 1,
        occurredAt: new Date().toISOString(),
        subscriptionId: 123,
      })
    previousEvents = events
    snapshot = {
      ...snapshot,
      resetCardsAvailable:
        type === "reset" ? snapshot.resetCardsAvailable : type === "triple" ? oldCards() + 3 : newCards(),
      subscriptionStatus: {
        ...snapshot.subscriptionStatus!,
        ...(type === "reset" || type === "both"
          ? { shortWindow: windowQuota(newShort()), weeklyWindow: windowQuota(newWeek()) }
          : {}),
      },
    }
    refresh()
  }
  return (
    <main data-campus-workspace="true">
      <nav>
        <b>{resolveBrand().shortName}</b>
        <span>新建会话</span>
        <span>项目与文件</span>
        <small>
          Reward Motion QA
          <br />
          本地合成账户 · 不连接服务器
        </small>
      </nav>
      <section class="qa-workspace">
        <span class="qa-eyebrow">WORKSPACE / MOTION REVIEW</span>
        <h1>让每一次补给，都有迹可循。</h1>
        <p>真实奖励组件、真实额度球与账户面板。此页的账户响应为测试数据。</p>
        <div class="qa-controls">
          <label>
            旧 5h
            <input
              aria-label="old short"
              type="number"
              min="0"
              max="100"
              value={oldShort()}
              onInput={(e) => setOldShort(+e.currentTarget.value)}
            />
          </label>
          <label>
            新 5h
            <input
              aria-label="new short"
              type="number"
              min="0"
              max="100"
              value={newShort()}
              onInput={(e) => setNewShort(+e.currentTarget.value)}
            />
          </label>
          <label>
            旧周
            <input
              aria-label="old week"
              type="number"
              min="0"
              max="100"
              value={oldWeek()}
              onInput={(e) => setOldWeek(+e.currentTarget.value)}
            />
          </label>
          <label>
            新周
            <input
              aria-label="new week"
              type="number"
              min="0"
              max="100"
              value={newWeek()}
              onInput={(e) => setNewWeek(+e.currentTarget.value)}
            />
          </label>
          <label>
            旧卡
            <input
              aria-label="old cards"
              type="number"
              min="0"
              value={oldCards()}
              onInput={(e) => setOldCards(+e.currentTarget.value)}
            />
          </label>
          <label>
            新卡
            <input
              aria-label="new cards"
              type="number"
              min="0"
              value={newCards()}
              onInput={(e) => setNewCards(+e.currentTarget.value)}
            />
          </label>
          <label>
            速度
            <select
              aria-label="speed"
              value="0.5"
              onChange={(e) =>
                window.dispatchEvent(new CustomEvent("reward-qa-speed", { detail: +e.currentTarget.value }))
              }
            >
              <option value="1">1×</option>
              <option value="0.5">0.5×</option>
              <option value="0.25">0.25×</option>
            </select>
          </label>
          <label>
            Reduced Motion
            <input
              type="checkbox"
              aria-label="reduced motion"
              onChange={(e) =>
                window.dispatchEvent(new CustomEvent("reward-qa-reduced", { detail: e.currentTarget.checked }))
              }
            />
          </label>
          <button onClick={prepare}>设置旧状态</button>
          <button onClick={() => trigger("reset")}>FULL RESET</button>
          <button onClick={() => trigger("card")}>RESET CARD</button>
          <button onClick={() => trigger("both")}>MULTIPLE REWARDS</button>
          <button onClick={() => trigger("triple")}>THREE CARDS</button>
          <button
            onClick={() => {
              events = previousEvents
              refresh()
            }}
          >
            DUPLICATE
          </button>
          <button
            onClick={() => {
              offline = !offline
              refresh()
            }}
          >
            NETWORK FAILURE / RECOVER
          </button>
        </div>
        <div class="qa-chat">
          <p>草稿与焦点回归</p>
          <p>播放动画时继续输入，或切换下方模型；账户面板可通过左下额度球开关。</p>
        </div>
        <div class="qa-composer" data-reward-anchor="composer">
          <textarea aria-label="composer" placeholder="继续你的工作…" />
          <footer>
            <select aria-label="model">
              <option>gpt-6-astra</option>
              <option>gpt-6-sol</option>
            </select>
            <button onClick={() => {}}>发送 ↗</button>
          </footer>
        </div>
      </section>
      <MucStatus />
    </main>
  )
}
render(() => <App />, document.getElementById("root")!)
