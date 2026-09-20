// MUC Harness: sub2api 余额/用量悬浮条。
// 仅在已连接状态渲染于主界面右下角；数据经主进程 IPC 拉取（凭据不出主进程）。
// 本文件为 mucode 新增文件，不修改上游共享组件。

import { Show, createSignal, onCleanup, onMount, For } from "solid-js"
import type { MucUsageSnapshot } from "../preload/types"

const STORE_NAME = "muc-status"
const REFRESH_MS = 5 * 60 * 1000

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

export function MucStatus() {
  const [open, setOpen] = createSignal(false)
  const [usage, setUsage] = createSignal<MucUsageSnapshot | null>(null)
  const [fetchedAt, setFetchedAt] = createSignal<string>("")
  const [stale, setStale] = createSignal(false)
  const [loading, setLoading] = createSignal(false)

  const cache = (v: Cached | null): Cached | null => {
    if (v) {
      void window.api.storeSet(STORE_NAME, "last", JSON.stringify(v))
      return v
    }
    return null
  }

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await window.api.mucGetUsage()
      if (res.ok) {
        setUsage(res.usage)
        setFetchedAt(new Date().toISOString())
        setStale(false)
        cache({ usage: res.usage, fetchedAt: new Date().toISOString() })
      } else {
        // 拉取失败：回退上次缓存并标记过期
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
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })

  const remainingText = () => {
    const u = usage()
    if (!u) return "—"
    if (u.remaining === null) return "不限"
    return fmtMoney(u.remaining)
  }

  return (
    <div
      class="fixed bottom-3 left-3 z-[9999] select-none font-sans text-[12px]"
      onBlur={() => setOpen(false)}
    >
      <Show
        when={open()}
        fallback={
          <button
            type="button"
            class="flex items-center gap-2 rounded-full border border-white/20 bg-neutral-900 px-3 py-1.5 text-white shadow-[0_2px_10px_rgba(0,0,0,0.55)] hover:bg-neutral-800"
            onClick={() => setOpen(true)}
            title="sub2api 账户用量"
          >
            <span
              class="inline-block size-1.5 rounded-full"
              classList={{ "bg-emerald-400": !stale(), "bg-amber-400": stale() }}
            />
            <span class="max-w-[220px] truncate">
              {usage()?.planName || "sub2api"} · 剩余 {remainingText()}
              {usage() ? ` · 今日 ${fmtMoney(usage()!.todayCost)}` : ""}
            </span>
            <Show when={loading()}>
              <span class="animate-pulse text-white/60">…</span>
            </Show>
          </button>
        }
      >
        <div class="w-[280px] rounded-xl border border-black/10 bg-white p-3 text-[#1a1a1a] shadow-xl">
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
    </div>
  )
}
