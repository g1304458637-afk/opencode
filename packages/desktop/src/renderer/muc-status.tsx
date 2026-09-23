import { createRewardArrivalAnimator, RewardArrivalLayer } from "./reward-arrival"
import { initI18n } from "./i18n"
import { isSystemReward } from "../shared/reward-arrival"
import { resolveBrand } from "@opencode-ai/brand"
// MUC Harness: sub2api 余额/用量悬浮球。
// 可自由拖动的圆形悬浮球（位置持久化），点击展开用量详情面板（吸附在球上方）。
// 数据经主进程 IPC 拉取（凭据不出主进程）。本文件为 mucode 新增文件。
//
// 额度面板只显示剩余百分比；金额留在网站钱包及管理员账单。

import { Show, createSignal, onCleanup, onMount, Index } from "solid-js"
import type { MucUpdateState, MucUsageSnapshot } from "../preload/types"
import { QuotaOrb, EnergyProgressBar, QuotaPanel, createResetChargeEffect } from "./quota-energy"
import { quotaReadings } from "./quota-energy-state"

const brand = resolveBrand()
const STORE_NAME = `${brand.credentialNamespace}-status`
const REFRESH_MS = 30 * 1000
const BALL_SIZE = 80
const PANEL_WIDTH = 304
const EDGE = 16

type Pos = { x: number; y: number }

// 民大红黑金 tokens（局部作用域：悬浮球 + 面板）
const MUC_TOKENS = `
  .muc-status-scope {
    --muc-red: ${brand.colors.primary};
    --muc-red-bright: color-mix(in srgb, ${brand.colors.primary}, white 55%);
    --muc-red-deep: ${brand.colors.primaryDark};
    --muc-red-soft: ${brand.colors.primary}2e;
    --muc-red-border: ${brand.colors.primary}73;
    --muc-red-glow: ${brand.colors.primary}47;
    --muc-gold: ${brand.colors.gold};
    --muc-glass-border: rgba(255, 255, 255, 0.12);
    --muc-text-primary: #ffffff;
    --muc-text-secondary: rgba(255, 255, 255, 0.68);
    --muc-text-muted: rgba(255, 255, 255, 0.42);
    --muc-danger: #ff4550;
  }
`

const fmtPercent = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "—"
  if (value > 0 && value < 1) return "<1%"
  return `${Math.floor(Math.max(0, Math.min(100, value)))}%`
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
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return iso
  }
}

const clampPos = (p: Pos): Pos => ({
  x: Math.min(Math.max(p.x, EDGE), Math.max(EDGE, window.innerWidth - BALL_SIZE - EDGE)),
  y: Math.min(Math.max(p.y, EDGE), Math.max(EDGE, window.innerHeight - BALL_SIZE - EDGE)),
})

const defaultPos = (): Pos => ({ x: EDGE, y: window.innerHeight - BALL_SIZE - EDGE })

export function MucStatus() {
  const charge = createResetChargeEffect()
  const rewards = createRewardArrivalAnimator()
  const [paused, setPaused] = createSignal(document.hidden)
  const [viewport, setViewport] = createSignal({ width: window.innerWidth, height: window.innerHeight })
  const [open, setOpen] = createSignal(false)
  const [usage, setUsage] = createSignal<MucUsageSnapshot | null>(null)
  const [fetchedAt, setFetchedAt] = createSignal("")
  const [stale, setStale] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [pos, setPos] = createSignal(defaultPos())
  const [update, setUpdate] = createSignal<MucUpdateState | null>(null)

  // 有新版本时返回非空对象（供 Show 收窄）；否则 null
  const updateAvailable = () => {
    const u = update()
    return u?.available ? u : null
  }

  const updateUnavailable = () => {
    const value = update()
    return value && !value.available && value.status === "unavailable"
  }

  const refreshUpdate = async () => {
    try {
      const result = await window.api.mucGetUpdate()
      if (!disposed) setUpdate(result)
    } catch {}
  }
  // 重置卡流程：confirming=确认层 / animating=成功动画层（先 API 成功再动画）
  const [resetPhase, setResetPhase] = createSignal<
    "idle" | "confirming" | "submitting" | "success" | "failed" | "refreshing"
  >("idle")
  const resetConfirming = () => resetPhase() === "confirming" || resetPhase() === "submitting"
  const resetBusy = () => ["submitting", "success", "refreshing"].includes(resetPhase())
  let disposed = false
  let refreshSequence = 0
  let animationTimer: ReturnType<typeof setTimeout> | undefined
  const [resetError, setResetError] = createSignal("")

  const refresh = async (confirmedReset = false) => {
    const sequence = ++refreshSequence
    setLoading(true)
    try {
      const [res] = await Promise.all([window.api.mucGetUsage(), initI18n()])
      if (disposed || sequence !== refreshSequence) return false
      if (!res.ok) {
        charge.cancel()
        setStale(true)
        return false
      }
      const arrivals = res.usage.rewardArrivals ?? []
      const rewardedReset = arrivals.some(
        (event) => isSystemReward(event) && event.subscriptionId === res.usage.subscriptionStatus?.id,
      )
      charge.observe(usage()?.subscriptionStatus, res.usage.subscriptionStatus, confirmedReset || rewardedReset)
      rewards.receive(arrivals)
      setUsage(res.usage)
      setFetchedAt(new Date().toISOString())
      setStale(false)
      return true
    } catch {
      if (!disposed && sequence === refreshSequence) {
        charge.cancel()
        setStale(true)
      }
      return false
    } finally {
      if (!disposed && sequence === refreshSequence) setLoading(false)
    }
  }

  const subscriptionStatus = () => usage()?.subscriptionStatus ?? null
  const resetCardsAvailable = () => {
    const n = usage()?.resetCardsAvailable
    return typeof n === "number" && n > 0 ? n : 0
  }
  const quotaWindows = () => {
    const sub = subscriptionStatus()
    if (!sub) return []
    if (sub.quotaPolicy === "dual_window_v1")
      return [
        { label: "5 小时剩余", data: sub.shortWindow },
        { label: "本周剩余", data: sub.weeklyWindow },
      ]
    return [
      {
        label: "本周剩余",
        data:
          sub.weeklyUsagePercent === null
            ? undefined
            : {
                remainingPercent: 100 - sub.weeklyUsagePercent,
                startsAt: sub.weeklyPeriodStartedAt ?? null,
                resetsAt: sub.weeklyPeriodEndsAt ?? null,
                exhausted: sub.weeklyUsagePercent >= 100,
              },
      },
    ]
  }
  const limitingWindow = () => {
    const windows = quotaWindows()
    if (windows.some((w) => !w.data)) return undefined
    return windows.sort((a, b) => a.data!.remainingPercent - b.data!.remainingPercent)[0]
  }
  const visualWindow = (index: number) =>
    stale() ? null : (charge.values()[index] ?? quotaReadings(subscriptionStatus())[index]?.value)
  const visualRemaining = () => {
    if (stale()) return null
    const readings = quotaReadings(subscriptionStatus()).map((_, index) => visualWindow(index))
    if (!readings.length || readings.some((value) => value == null)) return null
    return Math.min(...readings.filter((value): value is number => value != null))
  }
  const remainingText = () => fmtPercent(visualRemaining())
  const remainingLabel = () =>
    stale() ? "待刷新" : subscriptionStatus() ? (limitingWindow()?.label ?? "额度状态") : "未订阅"

  // 重置卡：确认 → API 成功 → 播放 AVAILABLE QUOTA 动画
  const confirmResetCard = async () => {
    if (resetBusy()) return
    const target = subscriptionStatus()
    if (!target || target.weeklyUsagePercent === null) {
      setResetPhase("idle")
      return
    }
    setResetPhase("submitting")
    ++refreshSequence
    setResetError("")
    try {
      const res = await window.api.mucResetCard(target.id)
      if (disposed) return
      if (!res.ok) {
        setResetError(
          res.error === "reconciliation_required"
            ? "上次重置结果尚未确认。请重新核对；若持续无法确认，请联系站点管理员核查，勿重复用卡。"
            : `重置失败：${res.error}`,
        )
        setResetPhase("failed")
        return
      }
      setResetPhase("refreshing")
      const refreshed = await refresh(true)
      if (disposed) return
      if (refreshed) {
        await window.api.mucAcknowledgeReset(target.id, res.operationId)
      }
      if (!refreshed) setResetError("重置已成功，状态刷新失败；请刷新或重试确认结果。")
      setResetPhase("success")
      clearTimeout(animationTimer)
      animationTimer = setTimeout(() => {
        if (!disposed) setResetPhase("idle")
      }, 2200)
    } catch {
      if (!disposed) {
        setResetError("网络异常，请重试同一次重置。")
        setResetPhase("failed")
      }
    }
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
      if (raw && !disposed) {
        try {
          const saved: unknown = JSON.parse(raw)
          if (
            saved &&
            typeof saved === "object" &&
            "x" in saved &&
            "y" in saved &&
            typeof saved.x === "number" &&
            typeof saved.y === "number" &&
            Number.isFinite(saved.x) &&
            Number.isFinite(saved.y)
          ) {
            setPos(clampPos({ x: saved.x, y: saved.y }))
          }
        } catch {}
      }
    })
    void refresh()
    void refreshUpdate()
    const timer = setInterval(() => {
      if (!loading() && !resetBusy()) void refresh()
      void refreshUpdate()
    }, REFRESH_MS)
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      setPos((p) => clampPos(p))
    }
    const onVisibility = () => setPaused(document.hidden)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !resetBusy()) {
        setResetPhase("idle")
        setOpen(false)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("keydown", onKey)
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onResize)
    })
  })

  onCleanup(() => {
    disposed = true
    ++refreshSequence
    clearTimeout(animationTimer)
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
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.setPointerCapture(e.pointerId)
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
    }
  }

  const togglePanel = (event: MouseEvent) => {
    if (moved && event.detail !== 0) {
      moved = false
      return
    }
    if (!open()) void refreshUpdate()
    setOpen((value) => !value)
  }

  // 面板吸附在球正上方，左右夹取避免出屏
  const panelStyle = () => {
    const above = pos().y > viewport().height / 2
    const room = above ? pos().y - EDGE - 12 : viewport().height - pos().y - BALL_SIZE - EDGE - 12
    return {
      left: `${Math.min(Math.max(pos().x, EDGE), Math.max(EDGE, viewport().width - PANEL_WIDTH - EDGE))}px`,
      ...(above ? { bottom: `${viewport().height - pos().y + 12}px` } : { top: `${pos().y + BALL_SIZE + 12}px` }),
      "--panel-max-height": `${Math.max(80, room)}px`,
    }
  }

  return (
    <>
      <RewardArrivalLayer
        animator={rewards}
        charge={charge.phase()}
        orb={{ x: pos().x + BALL_SIZE / 2, y: pos().y + BALL_SIZE / 2 }}
        onDetails={() => setOpen(true)}
      />
      <Show when={open()}>
        <QuotaPanel style={panelStyle()} phase={charge.phase()} paused={paused()}>
          <div class="quota-panel-header mb-2 flex items-center justify-between">
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
            <button
              type="button"
              class="quota-panel-close text-white/60 hover:text-white/80"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div class="mb-2 flex justify-between text-[10px] text-white/60">
            <span>
              {brand.shortName} · {update()?.localVersion ?? "—"}
            </span>
            <button type="button" onClick={() => void window.api.mucOpenAccount()}>
              账户 ↗
            </button>
          </div>
          <Show when={updateUnavailable()}>
            <p class="text-[10px] text-white/60">更新检查暂不可用</p>
          </Show>
          <Show when={updateAvailable()}>
            {(u) => (
              <button
                type="button"
                class="mb-2 flex w-full items-center justify-between rounded-lg bg-sky-50 px-2 py-1.5 text-[11px] text-sky-700 hover:bg-sky-100"
                onClick={() => void window.api.mucOpenDownloadPage()}
              >
                <span>
                  有新版本 {u().version}
                  <Show when={u().forced}>
                    <span class="ml-1 font-semibold">（必须更新）</span>
                  </Show>
                </span>
                <span>去下载 →</span>
              </button>
            )}
          </Show>

          <Show
            when={usage()}
            fallback={<div class="py-3 text-center text-white/50">{stale() ? "状态暂不可用，请重试" : "暂无数据"}</div>}
          >
            {(_u) => (
              <div class="flex flex-col gap-1.5">
                {/* 订阅块：本周使用 / 状态 / 恢复日 / 继续使用 / 重置卡 */}
                <Show when={subscriptionStatus()}>
                  {(ss) => (
                    <div class="quota-windows">
                      <Index each={quotaWindows()}>
                        {(w, index) => (
                          <div class="quota-window">
                            <div class="quota-window-heading">
                              <span>{w().label}</span>
                              <span>{fmtPercent(visualWindow(index))}</span>
                            </div>
                            <EnergyProgressBar
                              value={visualWindow(index)}
                              label={w().label}
                              phase={charge.values()[index] == null ? "idle" : charge.phase()}
                            />
                            <div class="quota-window-reset">
                              {w().data?.resetsAt
                                ? `${fmtDate(w().data!.resetsAt)} 恢复`
                                : w().data?.startsAt
                                  ? "到期前不再恢复"
                                  : w().data
                                    ? "首次使用后开始计时"
                                    : "状态暂不可用"}
                            </div>
                          </div>
                        )}
                      </Index>
                      <div class="mt-1.5 flex items-center justify-between text-[10px] text-white/50">
                        <span style={{ color: statusColor(ss().usageStatus) }}>
                          {USAGE_STATUS_LABELS[ss().usageStatus] ?? ss().usageStatus}
                        </span>
                        <span>
                          <Show when={ss().quotaPolicy !== "dual_window_v1" && ss().weeklyPeriodEndsAt} fallback={null}>
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
                      <div class="quota-reset-row mt-1.5 flex items-center justify-between">
                        <span
                          class="quota-reset-count text-[11px]"
                          data-reward={
                            rewards.active() && !isSystemReward(rewards.active()!) ? rewards.phase() : undefined
                          }
                          style={{ color: "var(--muc-gold)" }}
                        >
                          重置卡 ×{usage()?.resetCardsAvailable ?? "—"}
                        </span>
                        <button
                          type="button"
                          class="rounded-md px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
                          style={{
                            border: "1px solid var(--muc-glass-border)",
                            background: "rgba(255,255,255,0.05)",
                            color: "var(--muc-text-primary)",
                          }}
                          disabled={resetCardsAvailable() <= 0 || resetConfirming() || resetBusy() || stale()}
                          onClick={() => setResetPhase("confirming")}
                        >
                          使用
                        </button>
                      </div>
                      <Show when={resetError()}>
                        <p class="mt-1 text-[10px]" style={{ color: "var(--muc-danger)" }}>
                          {resetError()}
                          <Show when={!resetBusy() && !resetConfirming()}>
                            <button
                              type="button"
                              class="ml-2 underline"
                              disabled={resetBusy()}
                              onClick={() => void confirmResetCard()}
                            >
                              重新核对
                            </button>
                          </Show>
                        </p>
                      </Show>
                    </div>
                  )}
                </Show>

                <Show when={!subscriptionStatus()}>
                  <p class="py-2 text-white/60">暂无有效订阅，请在网站管理套餐。</p>
                </Show>
                <Show when={subscriptionStatus()}>
                  <p class="text-[10px] text-white/50">订阅到期：{fmtDate(subscriptionStatus()!.expiresAt)}</p>
                </Show>

                <div class="mt-1 flex items-center justify-between text-[10px] text-white/40">
                  <span>
                    数据时间 {fetchedAt() ? fmtTime(fetchedAt()) : "—"}
                    {stale() ? "（已过期）" : ""}
                  </span>
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-50"
                    disabled={loading() || resetBusy()}
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
                {subscriptionStatus()?.quotaPolicy === "dual_window_v1"
                  ? "同时恢复 5 小时和周额度，并从现在重新计时。未用额度不叠加，不延长订阅；尚未结算的请求会消耗恢复后的额度。"
                  : "恢复周额度并重新计时，不延长订阅。"}{" "}
                重置卡不可退回。
              </p>
              <div class="mt-1 flex gap-2">
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1 text-[11px]"
                  style={{ border: "1px solid var(--muc-glass-border)", color: "var(--muc-text-secondary)" }}
                  disabled={resetBusy()}
                  onClick={() => setResetPhase("idle")}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-black"
                  disabled={resetBusy()}
                  onClick={() => void confirmResetCard()}
                >
                  {resetPhase() === "submitting" ? "提交中…" : "确认使用"}
                </button>
              </div>
            </div>
          </Show>

          <Show when={resetPhase() === "success"}>
            <p class="quota-reset-feedback" role="status">
              额度已恢复
            </p>
          </Show>
        </QuotaPanel>
      </Show>

      {/* 悬浮球显示限制最紧的周期剩余百分比 */}
      <button
        type="button"
        title="订阅剩余额度（可拖动）"
        class="muc-status-scope quota-orb-button"
        data-reward={rewards.active() && !isSystemReward(rewards.active()!) ? rewards.phase() : undefined}
        aria-expanded={open()}
        data-energy-paused={paused()}
        style={{ left: `${pos().x}px`, top: `${pos().y}px`, width: `${BALL_SIZE}px`, height: `${BALL_SIZE}px` }}
        onClick={togglePanel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragging = false
          moved = false
        }}
      >
        <QuotaOrb value={visualRemaining()} label={remainingLabel()} text={remainingText()} phase={charge.phase()} />
        <Show when={updateAvailable()}>
          <span class="absolute left-1 top-1 flex size-3.5 items-center justify-center rounded-full bg-sky-400 text-[8px] font-bold leading-none text-white">
            新
          </span>
        </Show>
        <Show when={loading()}>
          <span class="absolute inset-0 rounded-full border border-white/20" />
        </Show>
      </button>
    </>
  )
}
