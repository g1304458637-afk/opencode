import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { isSystemReward, mergeRewardArrivals, type RewardArrival } from "../shared/reward-arrival"
import { t } from "./i18n"
import type { ChargePhase } from "./quota-energy-state"
import "./reward-arrival.css"

type ArrivalPhase = "notice" | "reveal" | "absorb" | "settle" | "leaving"

/** One bounded notification at a time; no idle animation loop or focus mutation. */
export function createRewardArrivalAnimator() {
  const [active, setActive] = createSignal<RewardArrival>()
  const [phase, setPhase] = createSignal<ArrivalPhase>("notice")
  let pending: RewardArrival[] = []
  let timers: ReturnType<typeof setTimeout>[] = []
  let disposed = false
  const clear = () => {
    timers.forEach(clearTimeout)
    timers = []
  }
  const next = () => {
    if (disposed || document.hidden) return
    const reward = pending.shift()
    if (!reward) return
    clear()
    setPhase("notice")
    setActive(reward)
    timers = [
      setTimeout(() => setPhase("reveal"), 300),
      setTimeout(() => setPhase("absorb"), 900),
      setTimeout(() => setPhase("settle"), 1600),
      setTimeout(() => setPhase("leaving"), 7600),
      setTimeout(() => {
        setActive(undefined)
        timers = [
          setTimeout(() => {
            timers = []
            next()
          }, 1000),
        ]
      }, 8000),
    ]
  }
  const receive = (events: RewardArrival[]) => {
    if (!events.length || disposed) return
    // Merge while readable without restarting animation or its dismissal timer.
    const current = active()
    const merged = mergeRewardArrivals(events)
    const rest: RewardArrival[] = []
    for (const event of merged) {
      if (
        current &&
        phase() !== "leaving" &&
        mergeRewardArrivals([current, event]).length === 1
      ) {
        setActive((value) => (value ? mergeRewardArrivals([value, event])[0] : event))
      } else rest.push(event)
    }
    pending = mergeRewardArrivals([...pending, ...rest]).slice(0, 8)
    if (!active() && timers.length === 0) next()
  }
  const dismiss = () => {
    clear()
    setActive(undefined)
    timers = [
      setTimeout(() => {
        timers = []
        next()
      }, 1000),
    ]
  }
  onMount(() => {
    const visibility = () => {
      if (document.hidden) {
        clear()
        // Keep text readable on return, but never replay an absorption flight.
        if (active()) setPhase("settle")
        return
      }
      if (active()) timers = [setTimeout(dismiss, 6000)]
      else {
        timers = []
        next()
      }
    }
    document.addEventListener("visibilitychange", visibility)
    onCleanup(() => document.removeEventListener("visibilitychange", visibility))
  })
  onCleanup(() => {
    disposed = true
    clear()
    pending = []
  })
  return { active, phase, receive, dismiss }
}

export function rewardCopy(event: RewardArrival) {
  if (isSystemReward(event)) return { title: t("reward.system.title"), body: t("reward.system.body") }
  if (event.quantity === 1) return { title: t("reward.card.one.title"), body: t("reward.card.one.body") }
  return { title: t("reward.card.many.title", { count: event.quantity }), body: t("reward.card.many.body") }
}

export function RewardCardVisual(props: { quantity: number; system?: boolean }) {
  return (
    <span class="reward-card-visual" data-system={props.system} aria-hidden="true">
      <span class="reward-card-core" />
      <span class="reward-card-scan" />
      <span class="reward-card-mark" />
      <Show when={!props.system}>
        <span class="reward-card-quantity">+{props.quantity}</span>
      </Show>
    </span>
  )
}

export function RewardToast(props: {
  event: RewardArrival
  phase: ArrivalPhase
  charge: ChargePhase
  orb: { x: number; y: number }
  onDetails: () => void
  onDismiss: () => void
}) {
  let origin!: HTMLDivElement
  const [flight, setFlight] = createSignal<JSX.CSSProperties>({})
  onMount(() => {
    // One geometry measurement per arrival, not a permanent RAF loop.
    const timer = setTimeout(() => {
      const rect = origin.getBoundingClientRect()
      setFlight({
        "--arrival-x": `${props.orb.x - (rect.x + rect.width / 2)}px`,
        "--arrival-y": `${props.orb.y - (rect.y + rect.height / 2)}px`,
      })
    }, 800)
    onCleanup(() => clearTimeout(timer))
  })
  return (
    <aside
      class="muc-status-scope reward-arrival"
      data-mode={isSystemReward(props.event) ? "system" : "card"}
      data-phase={props.phase}
      style={flight()}
    >
      <div class="reward-arrival-glass">
        <div class="reward-visual-origin" ref={origin}>
          <RewardCardVisual quantity={props.event.quantity} system={isSystemReward(props.event)} />
        </div>
        <div class="reward-arrival-copy" role="status" aria-live="polite" aria-atomic="true">
          <span class="reward-eyebrow">
            {t(isSystemReward(props.event) ? "reward.system.label" : "reward.card.label")}
          </span>
          <strong>{rewardCopy(props.event).title}</strong>
          <p>{rewardCopy(props.event).body}</p>
        </div>
        <button class="reward-dismiss" type="button" aria-label={t("reward.action.dismiss")} onClick={props.onDismiss}>
          ×
        </button>
        <div class="reward-footer">
          <span>
            {t(
              isSystemReward(props.event)
                ? props.charge !== "idle" && props.charge !== "settle" && props.charge !== "fullPulse"
                  ? "reward.status.charging"
                  : "reward.status.full"
                : "reward.status.received",
            )}
          </span>
          <button type="button" onClick={props.onDetails}>
            {t("reward.action.details")} ↗
          </button>
        </div>
        <Show when={isSystemReward(props.event)}>
          <span class="reward-system-line" aria-hidden="true" />
        </Show>
      </div>
    </aside>
  )
}

/** Both levels share the same glass surface, queue and accessibility behavior. */
export const SystemBanner = RewardToast
export function RewardArrivalLayer(props: {
  animator: ReturnType<typeof createRewardArrivalAnimator>
  charge: ChargePhase
  orb: { x: number; y: number }
  onDetails: () => void
}) {
  return (
    <Show when={props.animator.active()}>
      {(event) => (
        <RewardToast
          event={event()}
          phase={props.animator.phase()}
          charge={props.charge}
          orb={props.orb}
          onDetails={props.onDetails}
          onDismiss={props.animator.dismiss}
        />
      )}
    </Show>
  )
}
