// MUC Harness: sub2api 余额/用量悬浮球。
// 可自由拖动的圆形悬浮球（位置持久化），点击展开用量详情面板（吸附在球上方）。
// 数据经主进程 IPC 拉取（凭据不出主进程）。本文件为 mucode 新增文件。

import { Show, createSignal, onCleanup, onMount, For } from "solid-js"
import type { MucUpdateState, MucUsageSnapshot } from "../preload/types"

const STORE_NAME = "muc-status"
const REFRESH_MS = 5 * 60 * 1000
const BALL_SIZE = 56
const PANEL_WIDTH = 280
const EDGE = 8

type Pos = { x: number; y: number }
type Cached = { usage: MucUsageSnapshot; fetchedAt: string }

const fmtMoney = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const s = abs >= 100 ? v.toFixed(0) : v.toFixed(2)
  return `$${s}`
}

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
  const [update, setUpdate] = createSignal<MucUpdateState | null>(null)

  // 有新版本时返回非空对象（供 Show 收窄）；否则 null
  const updateAvailable = () => {
    const u = update()
    return u?.available ? u : null
  }

  const refreshUpdate = async () => {
    try {
      setUpdate(await window.api.mucGetUpdate())
    } catch {}
  }

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

  onMount(() => {
    // 恢复上次拖动的位置（越界则回默认）
    void window.api.storeGet(STORE_NAME, "ballPos").then((raw) => {
      if (raw) {
        try {
          setPos(clampPos(JSON.parse(raw) as Pos))
        } catch {}
      }
    })
    void refresh()
    void refreshUpdate()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    const onResize = () => setPos((p) => clampPos(p))
    window.addEventListener("resize", onResize)
    onCleanup(() => {
      clearInterval(timer)
      window.removeEventListener("resize", onResize)
    })
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
      // 展开面板时顺带刷新一次新版本状态（主进程带缓存，无额外网络开销）
      if (!open()) void refreshUpdate()
      setOpen((v) => !v)
    }
  }

  // 面板吸附在球正上方，左右夹取避免出屏
  const panelStyle = () => ({
    left: `${Math.min(Math.max(pos().x, EDGE), Math.max(EDGE, window.innerWidth - PANEL_WIDTH - EDGE))}px`,
    top: `${Math.max(EDGE, pos().y - 10)}px`,
    transform: "translateY(-100%)",
  })

  const remainingText = () => {
    const u = usage()
    if (!u) return "—"
    if (u.remaining === null) return "不限"
    return fmtMoney(u.remaining)
  }

  return (
    <>
      <Show when={open()}>
        <div
          class="fixed z-[9998] w-[280px] rounded-xl border border-black/10 bg-white p-3 text-[#1a1a1a] shadow-xl"
          style={panelStyle()}
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="text-[13px] font-semibold">
              {usage()?.planName || "sub2api 账户"}
              <Show when={stale()}>
                <span class="ml-1.5 rounded bg-amber-100 px-1 text-[10px] text-amber-700">缓存</span>
              </Show>
            </span>
            <button type="button" class="text-black/40 hover:text-black" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

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

          <Show when={usage()} fallback={<div class="py-3 text-center text-black/50">暂无数据</div>}>
            {(u) => (
              <div class="flex flex-col gap-1.5">
                <div class="grid grid-cols-2 gap-1.5">
                  <div class="rounded-lg bg-black/[.04] px-2 py-1.5">
                    <div class="text-[10px] text-black/50">剩余</div>
                    <div class="text-[15px] font-semibold">
                      {remainingText()}
                      <span class="ml-0.5 text-[10px] font-normal text-black/40">{u().unit}</span>
                    </div>
                  </div>
                  <div class="rounded-lg bg-black/[.04] px-2 py-1.5">
                    <div class="text-[10px] text-black/50">今日</div>
                    <div class="text-[15px] font-semibold">{fmtMoney(u().todayCost)}</div>
                    <div class="text-[10px] text-black/40">{u().todayRequests} 次请求</div>
                  </div>
                </div>

                <Show when={u().quota}>
                  <div class="text-[11px] text-black/60">
                    配额：已用 {fmtMoney(u().quota!.used)} / {fmtMoney(u().quota!.limit)} {u().quota!.unit}
                  </div>
                </Show>

                <For each={u().rateWindows}>
                  {(w) => (
                    <div class="flex justify-between text-[11px] text-black/60">
                      <span>{w.window} 窗口</span>
                      <span>
                        {fmtMoney(w.used)} / {fmtMoney(w.limit)}
                      </span>
                    </div>
                  )}
                </For>

                <div class="flex justify-between text-[11px] text-black/60">
                  <span>累计</span>
                  <span>
                    {fmtMoney(u().totalCost)} · {u().totalRequests} 次
                  </span>
                </div>

                <Show when={u().expiresAt}>
                  <div class="flex justify-between text-[11px] text-black/60">
                    <span>Key 到期</span>
                    <span>{u().expiresAt!.slice(0, 10)}</span>
                  </div>
                </Show>

                <Show when={u().topModels.length > 0}>
                  <div class="mt-1 border-t border-black/5 pt-1.5">
                    <div class="mb-1 text-[10px] text-black/40">费用 Top 模型</div>
                    <For each={u().topModels}>
                      {(m) => (
                        <div class="flex justify-between text-[11px]">
                          <span class="max-w-[180px] truncate">{m.model}</span>
                          <span class="text-black/60">{fmtMoney(m.cost)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="mt-1 flex items-center justify-between text-[10px] text-black/40">
                  <span>
                    数据时间 {fetchedAt() ? fmtTime(fetchedAt()) : "—"}
                    {stale() ? "（已过期）" : ""}
                  </span>
                  <button
                    type="button"
                    class="rounded px-1.5 py-0.5 hover:bg-black/5 disabled:opacity-50"
                    disabled={loading()}
                    onClick={() => void refresh()}
                  >
                    {loading() ? "刷新中…" : "刷新"}
                  </button>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <button
        type="button"
        title="sub2api 账户用量（可拖动）"
        class="fixed z-[9999] flex touch-none flex-col items-center justify-center rounded-full border-2 border-white/25 bg-gradient-to-b from-[#c01215] to-[#8f0c0d] text-white shadow-[0_4px_14px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 active:scale-95"
        classList={{
          "cursor-grabbing opacity-80": dragging,
          "cursor-grab": !dragging,
        }}
        style={{ left: `${pos().x}px`, top: `${pos().y}px`, width: `${BALL_SIZE}px`, height: `${BALL_SIZE}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span class="text-[9px] leading-none text-white/75">余额</span>
        <span class="mt-0.5 max-w-full truncate px-1 text-[12px] font-bold leading-none">{remainingText()}</span>
        <span
          class="absolute right-0.5 top-0.5 size-2 rounded-full border border-white/60"
          classList={{ "bg-emerald-400": !stale(), "bg-amber-400": stale() }}
        />
        <Show when={updateAvailable()}>
          <span class="absolute left-1 top-1 flex size-3.5 animate-pulse items-center justify-center rounded-full bg-sky-400 text-[8px] font-bold leading-none text-white">
            新
          </span>
        </Show>
        <Show when={loading()}>
          <span class="absolute inset-0 animate-pulse rounded-full bg-white/10" />
        </Show>
      </button>
    </>
  )
}
