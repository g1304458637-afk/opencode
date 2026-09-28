import { createSignal, onCleanup, onMount, Show, For } from "solid-js"
import { Portal } from "solid-js/web"
import { resolveBrand } from "@opencode-ai/brand"
import type { RewardArrival } from "../shared/reward-arrival"
import type { MucUsageSnapshot } from "../preload/types"
import {
  enqueueRewards,
  rewardEvents,
  rewardFrame,
  rewardMotionTokens,
  rewardSnapshot,
  type RewardEvent,
} from "./reward-motion-state"
import { t } from "./i18n"
import "./reward-motion.css"

/** One finite clock owns the sequence, presentation snapshot and breathing gap. */
export function createRewardMotionController() {
  const [active, setActive] = createSignal<RewardEvent>()
  const [time, setTime] = createSignal(0)
  const [reduced, setReduced] = createSignal(false)
  const [lowPower, setLowPower] = createSignal(false)
  const [pending, setPending] = createSignal<RewardEvent[]>([])
  const [confirmation, setConfirmation] = createSignal<RewardEvent>()
  const seen = new Set<string>()
  let raf = 0
  let start = 0
  let gapUntil = 0
  let previousFrame = 0
  let slowFrames = 0
  let disposed = false
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let speed = 1
  const [playbackSpeed, setPlaybackSpeed] = createSignal(1)
  const dismiss = () => {
    clearTimeout(toastTimer)
    toastTimer = undefined
    setConfirmation(undefined)
  }
  const finish = () => {
    const event = active()
    setActive(undefined)
    if (!event) return
    dismiss()
    setConfirmation(event)
    toastTimer = setTimeout(dismiss, rewardMotionTokens.toast)
  }
  const tick = (now: number) => {
    raf = 0
    if (disposed || document.hidden) return
    if (!active() && now >= gapUntil) {
      const [next, ...rest] = pending()
      if (!next) return
      setPending(rest)
      start = now
      previousFrame = now
      slowFrames = 0
      setLowPower(false)
      setTime(0)
      setActive(next)
    }
    const event = active()
    if (event) {
      if (now - previousFrame > 36 && ++slowFrames > 5) setLowPower(true)
      previousFrame = now
      setTime((now - start) * speed)
      if (time() >= rewardMotionTokens.duration[event.type]) {
        finish()
        gapUntil = now + rewardMotionTokens.gap / speed
      }
    }
    if (active() || pending().length) raf = requestAnimationFrame(tick)
  }
  const wake = () => {
    if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(tick)
  }
  const cancel = () => {
    cancelAnimationFrame(raf)
    raf = 0
    setActive(undefined)
    setPending([])
  }
  const receive = (arrivals: RewardArrival[], before: MucUsageSnapshot | null, after: MucUsageSnapshot) => {
    if (disposed) return
    const snapshot = rewardSnapshot(after)
    const incoming = rewardEvents(arrivals, rewardSnapshot(before), snapshot)
    const current = active()
    // Aggregate burst grants without restarting the artifact clock or its geometry.
    const cards =
      current?.type === "RESET_CARD_GRANTED" && time() < 1260
        ? incoming.filter(
            (event, index) =>
              event.type === "RESET_CARD_GRANTED" &&
              !event.ids.some((id) => seen.has(id)) &&
              incoming.findIndex((candidate) => candidate.id === event.id) === index,
          )
        : []
    if (current && cards.length) {
      cards.forEach((event) => event.ids.forEach((id) => seen.add(id)))
      setActive({
        ...current,
        ids: [...current.ids, ...cards.flatMap((event) => event.ids)],
        payload: {
          ...current.payload,
          after: snapshot,
          arrival: {
            ...current.payload.arrival,
            quantity:
              current.payload.arrival.quantity + cards.reduce((sum, event) => sum + event.payload.arrival.quantity, 0),
          },
        },
      })
    } else if (current) {
      const changed =
        current.type === "FULL_RESET"
          ? current.payload.after.subscriptionId !== snapshot.subscriptionId ||
            JSON.stringify(current.payload.after.quota) !== JSON.stringify(snapshot.quota)
          : current.payload.after.cards !== snapshot.cards
      // Newer authoritative state wins immediately over stale interpolation.
      if (changed) setActive(undefined)
    }
    setPending((items) => items.map((item) => ({ ...item, payload: { ...item.payload, after: snapshot } })))
    setPending((items) => enqueueRewards(items, incoming, seen))
    wake()
  }
  onMount(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const motion = () => setReduced(media.matches)
    motion()
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
        // Complete current ownership transfer without replay when returning to the app.
        finish()
      } else wake()
    }
    media.addEventListener("change", motion)
    document.addEventListener("visibilitychange", visibility)
    onCleanup(() => {
      media.removeEventListener("change", motion)
      document.removeEventListener("visibilitychange", visibility)
    })
  })
  onCleanup(() => {
    disposed = true
    cancel()
    dismiss()
    seen.clear()
  })
  const frame = () => {
    const event = active()
    return event ? rewardFrame(event, time(), reduced()) : undefined
  }
  return {
    active,
    frame,
    time,
    reduced,
    lowPower,
    confirmation,
    receive,
    dismiss,
    cancel,
    playbackSpeed,
    quota: () =>
      active()?.type === "FULL_RESET"
        ? frame()?.quota
        : pending().find((event) => event.type === "FULL_RESET")?.payload.before.quota,
    cards: () =>
      active()?.type === "RESET_CARD_GRANTED"
        ? frame()?.cards
        : pending().find((event) => event.type === "RESET_CARD_GRANTED")?.payload.before.cards,
    // Called only by the separate development QA entry, never exposed on window in production.
    setReducedForQA: (value: boolean) => {
      if (import.meta.env.DEV) setReduced(value || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    },
    setSpeed: (value: number) => {
      if (import.meta.env.DEV && !active()) {
        speed = [0.25, 0.5, 1].includes(value) ? value : 1
        setPlaybackSpeed(speed)
      }
    },
  }
}
export type RewardMotionController = ReturnType<typeof createRewardMotionController>

export function RewardMotionLayer(props: { controller: RewardMotionController }) {
  return (
    <Portal>
      <Show when={props.controller.active()}>
        {(event) => <RewardScene event={event()} controller={props.controller} />}
      </Show>
    </Portal>
  )
}
function RewardScene(props: { event: RewardEvent; controller: RewardMotionController }) {
  const brand = resolveBrand()
  const reset = props.event.type === "FULL_RESET"
  let layer!: HTMLDivElement
  let artifact!: HTMLDivElement
  const [ready, setReady] = createSignal(false)
  const [anchored, setAnchored] = createSignal(false)
  onMount(() =>
    queueMicrotask(() => {
      if (!layer.isConnected) return
      // Conditional children finish mounting before the one geometry read batch.
      // Read the complete geometry batch before writes. No measurements occur in the animation clock.
      const orb = document.querySelector<HTMLElement>('[data-reward-anchor="orb"]')
      const inventory = document.querySelector<HTMLElement>('[data-reward-anchor="inventory"]')
      const composer = document.querySelector<HTMLElement>(
        '[data-reward-anchor="composer"], [data-component="prompt-input-v2"], [data-component="prompt-input"]',
      )
      const visible = (node: HTMLElement | null) =>
        node && node.getClientRects().length && node.getBoundingClientRect().width ? node : null
      const target = visible(inventory) ?? visible(orb)
      const origin = artifact.getBoundingClientRect()
      const destination = target?.getBoundingClientRect()
      const orbRect = orb?.getBoundingClientRect()
      const composerRect = composer?.getBoundingClientRect()
      const hero = layer.querySelector<HTMLElement>(".reward-hero")
      const heroRect = hero?.getBoundingClientRect()
      const headingRect = document.querySelector(".campus-new-session__hero h1")?.getBoundingClientRect()
      const point = (rect: DOMRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      if (destination) {
        const from = point(origin),
          to = point(destination)
        layer.style.setProperty("--flight-x", `${to.x - from.x}px`)
        layer.style.setProperty("--flight-y", `${to.y - from.y}px`)
        layer.style.setProperty("--arc-x", `${(to.x - from.x) * 0.48}px`)
        layer.style.setProperty("--arc-y", `${(to.y - from.y) * 0.48 - Math.min(90, innerHeight * 0.12)}px`)
        layer.style.setProperty("--target-x", `${to.x}px`)
        layer.style.setProperty("--target-y", `${to.y}px`)
        layer.style.setProperty("--target-width", `${destination.width}px`)
        layer.style.setProperty("--target-height", `${destination.height}px`)
        setAnchored(true)
      }
      if (orbRect) {
        const p = point(orbRect)
        layer.style.setProperty("--orb-x", `${p.x}px`)
        layer.style.setProperty("--orb-y", `${p.y}px`)
      }
      if (hero && heroRect && (composerRect || headingRect)) {
        const center = composerRect ?? headingRect!
        hero.style.left = `${center.x + center.width / 2}px`
        if (headingRect) hero.style.top = `${Math.max(64, headingRect.y - heroRect.height - 28)}px`
      }
      if (reset && composerRect) {
        const el = layer.querySelector<HTMLElement>(".reward-composer-ack")!
        Object.assign(el.style, {
          left: `${composerRect.x}px`,
          top: `${composerRect.y}px`,
          width: `${composerRect.width}px`,
          height: `${composerRect.height}px`,
        })
      }
      setReady(true)
    }),
  )
  const percent = (value: number | null) => (value === null ? "—" : `${Math.floor(value)}%`)
  return (
    <div
      ref={layer}
      class="reward-motion-layer"
      data-kind={props.event.type}
      data-phase={props.controller.frame()?.phase}
      data-ready={ready()}
      data-reduced={props.controller.reduced()}
      data-low-power={props.controller.lowPower()}
      data-anchored={anchored()}
      aria-hidden="true"
      style={{
        "--reward-duration": `${rewardMotionTokens.duration[props.event.type] / props.controller.playbackSpeed()}ms`,
        "--reward-gold": brand.colors.gold,
        "--reward-white": brand.colors.onDark,
      }}
    >
      <div class="reward-environment" />
      <Show when={reset}>
        <div class="reward-energy-path" />
        <div class="reward-wave" />
        <div class="reward-wave reward-wave-second" />
        <div class="reward-composer-ack" />
        <div class="reward-hero">
          <span class="reward-technical">{t("reward.motion.restore")}</span>
          <h2>{t("reward.motion.restored")}</h2>
          <strong class="reward-hero-value">
            {percent(Math.min(...(props.controller.frame()?.quota ?? []).filter((n): n is number => n !== null)))}
          </strong>
          <div class="reward-hero-windows">
            <For each={props.controller.frame()?.quota}>
              {(value, i) => (
                <span>
                  {t(
                    i() === 0 && props.event.payload.after.quota.length > 1
                      ? "reward.motion.short"
                      : "reward.motion.week",
                  )}{" "}
                  <b>{percent(value)}</b>
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>
      <div class="reward-artifact-position">
        <div class="reward-seed" />
        <div ref={artifact} class="reward-artifact">
          <header>
            <span>{brand.shortName}</span>
            <span class="reward-technical">{t("reward.motion.credential")}</span>
          </header>
          <div class="reward-restore-glyph">↻</div>
          <div class="reward-artifact-identity">
            <span class="reward-technical">{t("reward.motion.card")}</span>
            <strong>{t("reward.motion.cardName")}</strong>
          </div>
          <span class="reward-artifact-quantity">×{props.event.payload.arrival.quantity}</span>
          <div class="reward-foil" />
        </div>
        <span class="reward-artifact-caption">{t("reward.motion.received")}</span>
      </div>
      <Show when={!props.controller.reduced()}>
        <div class="reward-motes">
          <For each={Array.from({ length: reset ? 24 : 16 }, (_, i) => i)}>
            {(i) => (
              <i
                style={{
                  "--mote-x": `${Math.cos(i * 2.399) * (46 + (i % 5) * 16)}px`,
                  "--mote-y": `${Math.sin(i * 2.399) * (46 + (i % 5) * 16)}px`,
                  "--mote-size": `${1 + (i % 3)}px`,
                }}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={!reset && anchored()}>
        <div class="reward-landing" />
        <div class="reward-inventory-badge">
          {t("reward.motion.cardName")} ×{props.controller.frame()?.cards ?? props.event.payload.after.cards}
        </div>
      </Show>
    </div>
  )
}
