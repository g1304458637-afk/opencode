// MUC Harness: sub2api 余额/用量悬浮球。
// 可自由拖动的圆形悬浮球（位置持久化），点击展开用量详情面板（吸附在球上方）。
// 数据经主进程 IPC 拉取（凭据不出主进程）。本文件为 mucode 新增文件。
//
// Final Frontend 规范：
// - 悬浮球恒显钱包余额（语义稳定，不随订阅/按量模式切换）
// - 展开卡 = 订阅块（档位/本周%/状态/恢复日/继续使用/重置卡[使用]）+ 钱包块 + 用量块
// - 重置卡与 Website 走同一后端 API；API 成功后才播放「AVAILABLE QUOTA → 100%」动画
//   （与 Website frontend resetAnimation.ts 同语义，跨仓按同一规范精简实现）

import { Show, createSignal, onCleanup, onMount, For } from "solid-js"
import type { MucUsageSnapshot } from "../preload/types"
import {
  availableQuotaAfterReset,
  mucTween,
  MUC_SUCCESS_MS,
  type MucTweenHandle,
} from "./muc-reset-animation"

const STORE_NAME = "muc-status"
const REFRESH_MS = 5 * 60 * 1000
const BALL_SIZE = 56
const PANEL_WIDTH = 280
const EDGE = 8

type Pos = { x: number; y: number }
type Cached = { usage: MucUsageSnapshot; fetchedAt: string }

// 民大红黑金 tokens（局部作用域：悬浮球 + 面板）
const MUC_TOKENS = `
  .muc-status-scope {
    --muc-red: #c82433;
    --muc-red-bright: #e23848;
    --muc-red-deep: #7f1622;
    --muc-red-soft: rgba(200, 36, 51, 0.18);
    --muc-red-border: rgba(238, 56, 72, 0.45);
    --muc-red-glow: rgba(238, 56, 72, 0.28);
    --muc-gold: #d6b46a;
    --muc-glass-border: rgba(255, 255, 255, 0.12);
    --muc-text-primary: #ffffff;
    --muc-text-secondary: rgba(255, 255, 255, 0.68);
    --muc-text-muted: rgba(255, 255, 255, 0.42);
    --muc-danger: #ff4550;
  }
`

const fmtMoney = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const s = abs >= 100 ? v.toFixed(0) : v.toFixed(2)
  return `$${s}`
}

// Wallet（新合同）：8 位小数字符串 → $12.48 展示
const fmtWallet = (w: { balance: string } | null | undefined) => {
  if (!w || typeof w.balance !== "string") return null
  const n = Number(w.balance)
  return Number.isFinite(n) ? fmtMoney(n) : null
}

// usage_status → 文案与颜色（阈值由服务端定义，前端只做映射，不复制数值）
const USAGE_STATUS_LABELS: Record<string, string> = {
  unmetered: "不限",
  normal: "正常",
  high: "偏高",
  near_limit: "接近上限",
  exhausted: "已耗尽",
}

// 业务状态色分层：normal 柔白 / high 暖黄 / near_limit 橙 / exhausted 警示红（≠品牌红）
const statusColor = (status: string): string => {
  switch (status) {
    case "exhausted":
      return "var(--muc-danger)"
    case "near_limit":
      return "#f08c3a"
    case "high":
      return "#ecc94b"
    case "unmetered":
      return "var(--muc-gold)"
    default:
      return "rgba(255,255,255,0.72)"
  }
}

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch {
    return iso
  }
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
  } catch {
    return iso
  }
}

const clampPos = (p: Pos): Pos => ({
  x: Math.min(Math.max(p.x, EDGE), Math.max(EDGE, window.innerWidth - BALL_SIZE - EDGE)),
  y: Math.min(Math.max(p.y, EDGE), Math.max(EDGE, window.innerHeight - BALL_SIZE - EDGE)),
})

const defaultPos = (): Pos => ({ x: EDGE, y: window.innerHeight - BALL_SIZE - 12 })

export function MucStatus() {
  const [open, setOpen] = createSignal(false)
  const [usage, setUsage] = createSignal<MucUsageSnapshot | null>(null)
  const [fetchedAt, setFetchedAt] = createSignal<string>("")
  const [stale, setStale] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [pos, setPos] = createSignal<Pos>(defaultPos())
  // 重置卡流程：confirming=确认层 / animating=成功动画层（先 API 成功再动画）
  const [resetConfirming, setResetConfirming] = createSignal(false)
  const [resetAnimating, setResetAnimating] = createSignal(false)
  const [resetPercent, setResetPercent] = createSignal(0)
  const [resetNextEnd, setResetNextEnd] = createSignal("")
  const [resetError, setResetError] = createSignal("")
  let resetTween: MucTweenHandle | null = null

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await window.api.mucGetUsage()
      if (res.ok) {
        setUsage(res.usage)
        const now = new Date().toISOString()
        setFetchedAt(now)
        setStale(false)
        void window.api.storeSet(STORE_NAME, "last", JSON.stringify({ usage: res.usage, fetchedAt: now }))
      } else {
        const raw = await window.api.storeGet(STORE_NAME, "last")
        if (raw && !usage()) {
          try {
            const parsed = JSON.parse(raw) as Cached
            setUsage(parsed.usage)
            setFetchedAt(parsed.fetchedAt)
            setStale(true)
          } catch {}
        } else {
          setStale(true)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const subscriptionStatus = () => usage()?.subscriptionStatus ?? null
  const resetCardsAvailable = () => {
    const n = usage()?.resetCardsAvailable
    return typeof n === "number" && n > 0 ? n : 0
  }
  // 悬浮球/钱包块：恒显钱包余额（语义稳定；缺失时显示 —）
  const walletBalanceText = (): string => {
    const u = usage()
    return (u && fmtWallet(u.wallet)) || "—"
  }

  // 重置卡：确认 → API 成功 → 播放 AVAILABLE QUOTA 动画
  const confirmResetCard = async () => {
    const target = subscriptionStatus()
    if (!target || target.weeklyUsagePercent === null) {
      setResetConfirming(false)
      return
    }
    const res = await window.api.mucResetCard(target.id)
    setResetConfirming(false)
    if (!res.ok) {
      setResetError(`重置失败：${res.error}`)
      return
    }
    setResetError("")
    const { from, to } = availableQuotaAfterReset(target.weeklyUsagePercent)
    setResetPercent(from)
    setResetNextEnd(res.weeklyPeriodEndsAt)
    setResetAnimating(true)
    await refresh()
    resetTween?.cancel()
    resetTween = mucTween({
      from,
      to,
      durationMs: MUC_SUCCESS_MS,
      onUpdate: (v) => setResetPercent(Math.round(v)),
      onDone: () => {
        // 结束态短暂停留后回归正常面板，不长时间遮挡
        setTimeout(() => setResetAnimating(false), 600)
      },
    })
  }

  onMount(() => {
    // 注入 MUC tokens（全局一次）
    if (!document.getElementById("muc-status-tokens")) {
      const style = document.createElement("style")
      style.id = "muc-status-tokens"
      style.textContent = MUC_TOKENS
      document.head.appendChild(style)
    }
    // 恢复上次拖动的位置（越界则回默认）
    void window.api.storeGet(STORE_NAME, "ballPos").then((raw) => {
      if (raw) {
        try {
          setPos(clampPos(JSON.parse(raw) as Pos))
        } catch {}
      }
    })
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    const onResize = () => setPos((p) => clampPos(p))
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      clearInterval(timer)
      window.removeEventListener("resize", onResize)
    })
  })

  onCleanup(() => {
    resetTween?.cancel()
  })

  // ---- 拖拽：Pointer Events，位移 >4px 判定为拖动，否则视为点击 ----
  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let origX = 0
  let origY = 0

  const onPointerDown = (e: PointerEvent) => {
    dragging = true
    moved = false
    startX = e.clientX
    startY = e.clientY
    origX = pos().x
    origY = pos().y
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (moved || Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true
    if (moved) setPos(clampPos({ x: origX + dx, y: origY + dy }))
  }
  const onPointerUp = () => {
    if (!dragging) return
    dragging = false
    if (moved) {
      void window.api.storeSet(STORE_NAME, "ballPos", JSON.stringify(pos()))
    } else {
      setOpen((v) => !v)
    }
  }

  // 面板吸附在球正上方，左右夹取避免出屏
  const panelStyle = () => ({
    left: `${Math.min(Math.max(pos().x, EDGE), Math.max(EDGE, window.innerWidth - PANEL_WIDTH - EDGE))}px`,
    top: `${Math.max(EDGE, pos().y - 10)}px`,
    transform: "translateY(-100%)",
  })

  return (
    <>
      <Show when={open()}>
        <div
          class="muc-status-scope fixed z-[9998] w-[280px] rounded-xl border p-3 shadow-xl"
          style={{
            left: panelStyle().left,
            top: panelStyle().top,
            transform: panelStyle().transform,
            background: "rgba(12,12,14,0.95)",
            "border-color": "var(--muc-glass-border)",
            color: "var(--muc-text-primary)",
          }}
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="flex items-center gap-1.5 text-[13px] font-semibold">
              <Show when={subscriptionStatus()}>
                {(ss) => (
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ background: "var(--muc-red-soft)", color: "var(--muc-red-bright)" }}
                  >
                    {ss().displayName}
                  </span>
                )}
              </Show>
              {usage()?.planName || "sub2api 账户"}
              <Show when={stale()}>
                <span class="rounded bg-amber-100 px-1 text-[10px] text-amber-700">缓存</span>
              </Show>
            </span>
            <button type="button" class="text-white/40 hover:text-white/80" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          <Show when={usage()} fallback={<div class="py-3 text-center text-white/50">暂无数据</div>}>
            {(u) => (
              <div class="flex flex-col gap-1.5">
                {/* 订阅块：本周使用 / 状态 / 恢复日 / 继续使用 / 重置卡 */}
                <Show when={subscriptionStatus()}>
                  {(ss) => (
                    <div
                      class="rounded-lg px-2 py-1.5"
                      style={{ border: "1px solid var(--muc-red-border)", background: "var(--muc-red-soft)" }}
                    >
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] text-white/60">本周使用</span>
                        <span
                          class="text-[13px] font-semibold"
                          style={{ color: statusColor(ss().usageStatus) }}
                        >
                          {ss().weeklyUsagePercent === null ? "不限量" : `${ss().weeklyUsagePercent}%`}
                        </span>
                      </div>
                      <Show when={ss().weeklyUsagePercent !== null}>
                        <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            class="h-1.5 rounded-full transition-all"
                            style={{
                              width: `${Math.min(ss().weeklyUsagePercent ?? 0, 100)}%`,
                              background: statusColor(ss().usageStatus),
                            }}
                          />
                        </div>
                      </Show>
                      <div class="mt-1.5 flex items-center justify-between text-[10px] text-white/50">
                        <span>{USAGE_STATUS_LABELS[ss().usageStatus] ?? ss().usageStatus}</span>
                        <span>
                          <Show when={ss().weeklyPeriodEndsAt} fallback={null}>
                            {fmtDate(ss().weeklyPeriodEndsAt)} 恢复 ·{" "}
                          </Show>
                          继续使用{" "}
                          <span
                            class="font-bold"
                            style={{ color: ss().paygFallback ? "var(--muc-red-bright)" : "var(--muc-text-muted)" }}
                          >
                            {ss().paygFallback ? "ON" : "OFF"}
                          </span>
                        </span>
                      </div>
                      <div class="mt-1.5 flex items-center justify-between">
                        <span class="text-[11px]" style={{ color: "var(--muc-gold)" }}>
                          重置卡 ×{resetCardsAvailable()}
                        </span>
                        <button
                          type="button"
                          class="rounded-md px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
                          style={{
                            border: "1px solid var(--muc-glass-border)",
                            background: "rgba(255,255,255,0.05)",
                            color: "var(--muc-text-primary)",
                          }}
                          disabled={resetCardsAvailable() <= 0 || resetConfirming() || resetAnimating()}
                          onClick={() => setResetConfirming(true)}
                        >
                          使用
                        </button>
                      </div>
                      <Show when={resetError()}>
                        <p class="mt-1 text-[10px]" style={{ color: "var(--muc-danger)" }}>
                          {resetError()}
                        </p>
                      </Show>
                    </div>
                  )}
                </Show>

                {/* 钱包块：恒显钱包余额 */}
                <div class="grid grid-cols-2 gap-1.5">
                  <div class="rounded-lg bg-black/30 px-2 py-1.5">
                    <div class="text-[10px] text-white/50">钱包余额</div>
                    <div class="text-[15px] font-semibold">{walletBalanceText()}</div>
                  </div>
                  <div class="rounded-lg bg-black/30 px-2 py-1.5">
                    <div class="text-[10px] text-white/50">今日</div>
                    <div class="text-[15px] font-semibold">{fmtMoney(u().todayCost)}</div>
                    <div class="text-[10px] text-white/40">{u().todayRequests} 次请求</div>
                  </div>
                </div>

                <Show when={u().quota}>
                  <div class="text-[11px] text-white/60">
                    配额：已用 {fmtMoney(u().quota!.used)} / {fmtMoney(u().quota!.limit)} {u().quota!.unit}
                  </div>
                </Show>

                <For each={u().rateWindows}>
                  {(w) => (
                    <div class="flex justify-between text-[11px] text-white/60">
                      <span>{w.window} 窗口</span>
                      <span>
                        {fmtMoney(w.used)} / {fmtMoney(w.limit)}
                      </span>
                    </div>
                  )}
                </For>

                <div class="flex justify-between text-[11px] text-white/60">
                  <span>累计</span>
                  <span>
                    {fmtMoney(u().totalCost)} · {u().totalRequests} 次
                  </span>
                </div>

                <Show when={u().expiresAt}>
                  <div class="flex justify-between text-[11px] text-white/60">
                    <span>Key 到期</span>
                    <span>{u().expiresAt!.slice(0, 10)}</span>
                  </div>
                </Show>

                <Show when={u().topModels.length > 0}>
                  <div class="mt-1 border-t border-white/10 pt-1.5">
                    <div class="mb-1 text-[10px] text-white/40">费用 Top 模型</div>
                    <For each={u().topModels}>
                      {(m) => (
                        <div class="flex justify-between text-[11px]">
                          <span class="max-w-[180px] truncate">{m.model}</span>
                          <span class="text-white/60">{fmtMoney(m.cost)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="mt-1 flex items-center justify-between text-[10px] text-white/40">
                  <span>
                    数据时间 {fetchedAt() ? fmtTime(fetchedAt()) : "—"}
                    {stale() ? "（已过期）" : ""}
                  </span>
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-50"
                    disabled={loading()}
                    onClick={() => void refresh()}
                  >
                    {loading() ? "刷新中…" : "刷新"}
                  </button>
                </div>

                {/* 管理套餐：打开 Website Pricing（MUCODE 内不做支付） */}
                <button
                  type="button"
                  class="mt-0.5 rounded-md px-2 py-1 text-[11px] hover:bg-white/5"
                  style={{ border: "1px solid var(--muc-glass-border)", color: "var(--muc-text-secondary)" }}
                  onClick={() => void window.api.mucOpenPricing()}
                >
                  管理套餐 ↗
                </button>
              </div>
            )}
          </Show>

          {/* 重置卡确认层 */}
          <Show when={resetConfirming()}>
            <div
              class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl p-3 text-center"
              style={{ background: "rgba(7,7,8,0.96)" }}
            >
              <p class="text-[12px] font-semibold">使用重置卡？</p>
              <p class="text-[10px] leading-relaxed text-white/60">
                本周使用量将立即重置，并从现在重新开始 7 天周期。重置卡不可退回。
              </p>
              <div class="mt-1 flex gap-2">
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-[11px]"
                  style={{ border: "1px solid var(--muc-glass-border)", color: "var(--muc-text-secondary)" }}
                  onClick={() => setResetConfirming(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-black"
                  onClick={() => void confirmResetCard()}
                >
                  确认使用
                </button>
              </div>
            </div>
          </Show>

          {/* 重置成功动画层：AVAILABLE QUOTA → 100%（API 成功后播放） */}
          <Show when={resetAnimating()}>
            <div
              class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-xl"
              style={{ background: "rgba(7,7,8,0.96)" }}
            >
              <p class="text-[12px] font-semibold">额度已恢复</p>
              <div class="relative h-[92px] w-[92px]">
                <svg viewBox="0 0 100 100" class="h-full w-full -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="7" />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="var(--muc-red-bright)"
                    stroke-width="7"
                    stroke-linecap="round"
                    stroke-dasharray={(2 * Math.PI * 42).toString()}
                    stroke-dashoffset={(2 * Math.PI * 42 * (1 - resetPercent() / 100)).toString()}
                  />
                </svg>
                <div class="absolute inset-0 flex items-center justify-center text-[20px] font-bold tabular-nums">
                  {resetPercent()}%
                </div>
              </div>
              <p class="text-[9px] tracking-[0.3em] text-white/40">AVAILABLE QUOTA</p>
              <p class="text-[10px] text-white/60">
                {fmtDate(resetNextEnd())} 恢复 · 剩余 {Math.max(resetCardsAvailable() - 1, 0)} 张
              </p>
            </div>
          </Show>
        </div>
      </Show>

      {/* 悬浮球：恒显钱包余额 */}
      <button
        type="button"
        title="钱包余额（可拖动）"
        class="muc-status-scope fixed z-[9999] flex touch-none flex-col items-center justify-center rounded-full border-2 border-white/25 text-white shadow-[0_4px_14px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 active:scale-95"
        classList={{
          "cursor-grabbing opacity-80": dragging,
          "cursor-grab": !dragging,
        }}
        style={{
          left: `${pos().x}px`,
          top: `${pos().y}px`,
          width: `${BALL_SIZE}px`,
          height: `${BALL_SIZE}px`,
          background: "linear-gradient(to bottom, var(--muc-red), var(--muc-red-deep))",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span class="text-[9px] leading-none text-white/75">余额</span>
        <span class="mt-0.5 max-w-full truncate px-1 text-[12px] font-bold leading-none">{walletBalanceText()}</span>
        <span
          class="absolute right-0.5 top-0.5 size-2 rounded-full border border-white/60"
          classList={{ "bg-emerald-400": !stale(), "bg-amber-400": stale() }}
        />
        <Show when={loading()}>
          <span class="absolute inset-0 animate-pulse rounded-full bg-white/10" />
        </Show>
      </button>
    </>
  )
}
