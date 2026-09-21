// MUC Harness: 重置成功动画的共享语义（与 Website frontend/src/components/subscription/resetAnimation.ts
// 保持同一套参数与语义；跨仓无法直接复用，此处按同一规范实现精简版）。

/** 主 easing：cubic-bezier(0.22, 1, 0.36, 1)（Newton 迭代求值）。 */
export function mucEase(t: number): number {
  const p1x = 0.22, p1y = 1, p2x = 0.36, p2y = 1
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx
  if (t <= 0) return 0
  if (t >= 1) return 1
  let u = t
  for (let i = 0; i < 6; i++) {
    const dx = sampleX(u) - t
    if (Math.abs(dx) < 1e-5) break
    const d = sampleDX(u)
    if (Math.abs(d) < 1e-6) break
    u -= dx / d
  }
  return sampleY(u)
}

export const MUC_SUCCESS_MS = 1400

export interface MucTweenHandle {
  cancel: () => void
}

/** RAF 数字 tween；prefers-reduced-motion 时直接落终态。返回取消句柄（卸载必须调用）。 */
export function mucTween(options: {
  from: number
  to: number
  durationMs: number
  onUpdate: (value: number) => void
  onDone?: () => void
}): MucTweenHandle {
  const { from, to, durationMs, onUpdate, onDone } = options
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onUpdate(to)
    onDone?.()
    return { cancel: () => {} }
  }
  // 用 setInterval 而非 rAF 驱动：遮挡/后台窗口 rAF 会停发导致动画冻结；
  // 16ms interval 在前台平滑、后台被节流仍会推进直至完成，无常驻 CPU。
  let timer = 0
  let start = 0
  let cancelled = false
  const step = () => {
    if (cancelled) return
    const now = performance.now()
    if (!start) start = now
    const progress = Math.min((now - start) / durationMs, 1)
    onUpdate(from + (to - from) * mucEase(progress))
    if (progress >= 1) {
      clearInterval(timer)
      timer = 0
      onDone?.()
    }
  }
  timer = window.setInterval(step, 16)
  return {
    cancel: () => {
      cancelled = true
      if (timer) clearInterval(timer)
    },
  }
}

/**
 * Reset 成功动画语义：视觉指标 = AVAILABLE QUOTA = 100 − weekly_usage_percent。
 * 后端字段保持 used 语义（reset 后=0）；本动画只表达可用额度补满到 100% 的视觉。
 */
export function availableQuotaAfterReset(usedPercentBefore: number | null): {
  from: number
  to: number
} {
  const used = Math.min(Math.max(usedPercentBefore ?? 0, 0), 100)
  return { from: Math.round(100 - used), to: 100 }
}
