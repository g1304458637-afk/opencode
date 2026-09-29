import { createSignal, createEffect, onCleanup, onMount, Show, For } from "solid-js"
import { animate } from "@opencode-ai/ui/motion-timeline"
import { createRewardPainter, defaultRewardFx, defaultRewardPlaybackSpeed, type RewardFxOptions } from "./reward-fx"
import { playRewardSound, rewardSoundEnabled } from "./reward-sound"
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
  const [fx, setFx] = createSignal({ ...defaultRewardFx })
  const seen = new Set<string>()
  let raf = 0
  let start = 0
  let gapUntil = 0
  let previousFrame = 0
  let slowFrames = 0
  let disposed = false
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let speed: number = defaultRewardPlaybackSpeed
  const [playbackSpeed, setPlaybackSpeed] = createSignal(defaultRewardPlaybackSpeed)
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
      current?.type === "RESET_CARD_GRANTED" && time() < rewardMotionTokens.count[1]
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
    fx,
    configureFx: (change: Partial<RewardFxOptions>) => {
      if ((import.meta.env.DEV || import.meta.env.VITE_CAMPUS_REWARD_PREVIEW) && !active())
        setFx((value) => ({ ...value, ...change }))
    },
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
      if (import.meta.env.DEV || import.meta.env.VITE_CAMPUS_REWARD_PREVIEW)
        setReduced(value || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    },
    setSpeed: (value: number) => {
      if ((import.meta.env.DEV || import.meta.env.VITE_CAMPUS_REWARD_PREVIEW) && !active()) {
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
  let canvas!: HTMLCanvasElement
  const [ready, setReady] = createSignal(false)
  const [anchored, setAnchored] = createSignal(false)
  let geometry = { x: 0, y: 0, dx: 0, dy: 0, ax: 0, ay: 0, ox: 0, oy: 0 }
  onMount(() =>
    queueMicrotask(() => {
      if (!layer.isConnected) return
      const orb = document.querySelector<HTMLElement>('[data-reward-anchor="orb"]')
      const inventory = document.querySelector<HTMLElement>('[data-reward-anchor="inventory"]')
      const composer = document.querySelector<HTMLElement>(
        '[data-reward-anchor="composer"], [data-component="prompt-input-v2"], [data-component="prompt-input"]',
      )
      const visible = (node: HTMLElement | null) =>
        node && node.getClientRects().length && node.getBoundingClientRect().width ? node : null
      const target = visible(inventory) ?? visible(orb)
      const destination = target?.getBoundingClientRect()
      const orbRect = orb?.getBoundingClientRect()
      const composerRect = composer?.getBoundingClientRect()
      const modelRect = document
        .querySelector(
          '[data-component="prompt-input-v2"] button[aria-haspopup], [data-component="prompt-input"] button[aria-haspopup]',
        )
        ?.getBoundingClientRect()
      // Source stage is centered over the actual main content, avoiding the navigation column.
      const stageMargin = Math.min(350, innerWidth / 2)
      const x = Math.max(
        stageMargin,
        Math.min(innerWidth - stageMargin, composerRect ? composerRect.x + composerRect.width / 2 : innerWidth / 2),
      )
      const y = Math.max(180, Math.min(innerHeight * 0.43, innerHeight - 170))
      const targetX = destination ? destination.x + destination.width / 2 : x
      const targetY = destination ? destination.y + destination.height / 2 : y
      geometry = {
        x,
        y,
        dx: targetX - x,
        dy: targetY - y,
        ax: (targetX - x) * 0.42,
        ay: (targetY - y) * 0.3 - Math.min(130, innerHeight * 0.16),
        ox: orbRect ? orbRect.x + orbRect.width / 2 : x,
        oy: orbRect ? orbRect.y + orbRect.height / 2 : y,
      }
      Object.entries({
        "--stage-x": x,
        "--stage-y": y,
        "--orb-x": geometry.ox,
        "--orb-y": geometry.oy,
        "--target-x": targetX,
        "--target-y": targetY,
        "--target-width": destination?.width ?? 60,
        "--target-height": destination?.height ?? 40,
        "--flight-x": geometry.dx,
        "--flight-y": geometry.dy,
      }).forEach(([key, value]) => layer.style.setProperty(key, `${value}px`))
      if (composerRect && reset) {
        const ack = layer.querySelector<HTMLElement>(".reward-composer-ack")!
        Object.assign(ack.style, {
          left: `${composerRect.x}px`,
          top: `${composerRect.y}px`,
          width: `${composerRect.width}px`,
          height: `${composerRect.height}px`,
        })
        const status = layer.querySelector<HTMLElement>(".reward-ready")!
        status.style.left = `${modelRect?.x ?? composerRect.x + 24}px`
        status.style.top = `${(modelRect?.y ?? composerRect.y) - 24}px`
      }
      setAnchored(!!destination)
      setReady(true)
    }),
  )
  createEffect(() => {
    if (!ready() || props.controller.reduced()) return
    const painter = createRewardPainter(canvas, reset, geometry, { x: geometry.ox, y: geometry.oy })
    createEffect(() => painter.draw(props.controller.time(), props.controller.fx(), props.controller.lowPower()))
    onCleanup(painter.dispose)
  })
  createEffect(() => {
    if (!ready() || props.controller.reduced()) return
    const g = geometry
    const fx = props.controller.fx()
    const scene = reset
      ? animate([
          [
            layer.querySelector(".reward-hero")!,
            {
              opacity: [0, 1, 1, 0],
              transform: [
                "translate(-50%,-50%) scale(.7)",
                "translate(-50%,-50%) scale(1.06)",
                "translate(-50%,-50%) scale(1)",
                "translate(-50%,-50%) scale(1.06)",
              ],
              filter: ["blur(22px)", "blur(0px)", "blur(0px)", "blur(10px)"],
            },
            { at: 0.85, duration: 1.4, times: [0, 0.25, 0.7, 1], ease: "easeOut" },
          ],
        ])
      : animate([
          [
            artifact,
            {
              opacity: [0, 1, 1, 1],
              transform: [
                "translate(0px,0px) rotateY(70deg) rotateX(12deg) scale(.2)",
                "translate(0px,0px) rotateY(-8deg) rotateX(-3deg) scale(1.16)",
                "translate(0px,0px) rotateY(3deg) rotateX(1deg) scale(.98)",
                "translate(0px,0px) rotateY(0deg) rotateX(0deg) scale(1)",
              ],
              filter: [
                "blur(16px) brightness(3)",
                "blur(0px) brightness(1.6)",
                "blur(0px) brightness(1)",
                "blur(0px) brightness(1)",
              ],
            },
            { at: 0.28, duration: 0.52, times: [0, 0.6, 0.82, 1], ease: "easeOut" },
          ],
          [
            artifact,
            {
              transform: [
                "translate(0px,0px) rotateY(0deg) scale(1)",
                "translate(0px,-14px) rotateY(-5deg) scale(.92)",
                `translate(${g.ax}px,${g.ay}px) rotate(-16deg) rotateY(12deg) scale(.56)`,
                `translate(${g.dx}px,${g.dy}px) rotate(14deg) rotateY(0deg) scale(.09)`,
              ],
              opacity: [1, 1, 1, 0],
            },
            { at: 1.45, duration: 0.55, times: [0, 0.18, 0.58, 1], ease: "easeIn" },
          ],
        ])
    scene.pause()
    // Motion and canvas seek from the existing event clock, including slow motion and cancellation.
    createEffect(() => {
      scene.time = props.controller.time() / 1000
    })
    const root = document.getElementById("root")
    const camera =
      root && fx.impact > 0
        ? animate(
            root,
            {
              transform: [
                "translate(0px,0px)",
                `translate(${-fx.impact}px,1px)`,
                `translate(${fx.impact * 0.7}px,-1px)`,
                "translate(0px,0px)",
              ],
            },
            { delay: reset ? 1.15 : 0.46, duration: 0.14, ease: "linear" },
          )
        : undefined
    camera?.pause()
    createEffect(() => {
      if (camera) camera.time = props.controller.time() / 1000
    })
    onCleanup(() => {
      scene.cancel()
      camera?.cancel()
    })
  })
  createEffect(() => {
    if (!ready() || !rewardSoundEnabled() || props.controller.reduced()) return
    const stop = playRewardSound(reset, props.controller.playbackSpeed())
    onCleanup(stop)
  })
  const percent = (n: number | null) => (n === null ? "—" : `${Math.floor(n)}%`)
  return (
    <div
      ref={layer}
      class="reward-motion-layer"
      data-kind={props.event.type}
      data-phase={props.controller.frame()?.phase}
      data-ready={ready()}
      data-reduced={props.controller.reduced()}
      data-low-power={props.controller.lowPower()}
      data-intensity={props.controller.fx().intensity}
      data-anchored={anchored()}
      aria-hidden="true"
      style={{
        "--reward-duration": `${rewardMotionTokens.duration[props.event.type] / props.controller.playbackSpeed()}ms`,
        "--reward-gold": brand.colors.gold,
        "--reward-white": brand.colors.onDark,
        "--fx-bloom": props.controller.fx().bloom,
        "--fx-shock": props.controller.fx().shockwave,
      }}
    >
      <div class="reward-environment" />
      <div class="reward-window-rim" />
      <div class="reward-flash" />
      <canvas ref={canvas} class="reward-fx-canvas" />
      <Show when={reset}>
        <div class="reward-core" />
        <div class="reward-composer-ack" />
        <span class="reward-ready">{t("reward.fx.ready")}</span>
        <div class="reward-hero">
          <span class="reward-technical">{t("reward.fx.fullReset")}</span>
          <strong class="reward-hero-value">
            {percent(Math.min(...(props.controller.frame()?.quota ?? []).filter((n): n is number => n !== null)))}
          </strong>
          <h2>{t("reward.motion.restored")}</h2>
          <div class="reward-hero-windows">
            <For each={props.controller.frame()?.quota}>
              {(value, i) => (
                <div class="reward-hero-window">
                  <span>
                    {t(
                      i() === 0 && props.event.payload.after.quota.length > 1
                        ? "reward.motion.short"
                        : "reward.motion.week",
                    )}{" "}
                    <b>{percent(value)}</b>
                  </span>
                  <div class="reward-hero-track">
                    <i style={{ transform: `scaleX(${(value ?? 0) / 100})` }} />
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
      <Show when={!reset}>
        <div class="reward-portal" />
        <div class="reward-orbit" />
      </Show>
      <div class="reward-artifact-position">
        <div ref={artifact} class="reward-artifact">
          <header>
            <span>{brand.shortName}</span>
            <span class="reward-technical">{t("reward.fx.rarity")}</span>
          </header>
          <svg class="reward-restore-glyph" viewBox="0 0 80 80" fill="none">
            <path d="M59 25a26 26 0 1 0 7 26M58 12l3 16-16 1" stroke="currentColor" stroke-width="1.6" />
            <circle cx="40" cy="40" r="33" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="2 7" />
            <path d="M34 35h12v12H34z" stroke="currentColor" transform="rotate(45 40 41)" />
          </svg>
          <div class="reward-artifact-identity">
            <span class="reward-technical">{t("reward.motion.card")}</span>
            <strong>{t("reward.motion.cardName")}</strong>
          </div>
          <span class="reward-artifact-quantity">×{props.event.payload.arrival.quantity}</span>
          <div class="reward-foil" />
          <div class="reward-card-grain" />
        </div>
        <span class="reward-artifact-caption">
          {t("reward.motion.cardTitle", { count: props.event.payload.arrival.quantity })}
        </span>
      </div>
      <Show when={!reset && anchored()}>
        <div class="reward-landing" />
        <div class="reward-inventory-badge">
          +{props.event.payload.arrival.quantity} · {t("reward.motion.cardName")} ×
          {props.controller.frame()?.cards ?? props.event.payload.after.cards}
        </div>
      </Show>
    </div>
  )
}
