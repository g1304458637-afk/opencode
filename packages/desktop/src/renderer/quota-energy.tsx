import { createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type { MucSubscriptionStatus } from "../preload/types"
import { chargeFrame, quotaLevel, resetChargeTargets, type ChargePhase } from "./quota-energy-state"
import "./quota-energy.css"

/** Short lived presentation only. Never writes a quota or calls an API. */
export function createResetChargeEffect() {
  const [phase, setPhase] = createSignal<ChargePhase>("idle")
  const [values, setValues] = createSignal<Record<number, number>>({})
  let frame = 0
  let targets: ReturnType<typeof resetChargeTargets> = []
  const cancel = () => {
    cancelAnimationFrame(frame)
    frame = 0
    targets = []
    setValues({})
    setPhase("idle")
  }
  const observe = (
    before: MucSubscriptionStatus | null | undefined,
    after: MucSubscriptionStatus | null | undefined,
    confirmed = false,
  ) => {
    cancel()
    targets = resetChargeTargets(before, after, confirmed)
    if (!targets.length || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const start = performance.now()
    const tick = (now: number) => {
      const state = chargeFrame(now - start)
      setPhase(state.phase)
      setValues(
        Object.fromEntries(
          targets.map((target) => [target.index, target.from + (target.to - target.from) * state.progress]),
        ),
      )
      if (state.phase === "idle") return cancel()
      frame = requestAnimationFrame(tick)
    }
    tick(start)
  }
  onMount(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const changed = () => {
      if (motion.matches || document.hidden) cancel()
    }
    motion.addEventListener("change", changed)
    document.addEventListener("visibilitychange", changed)
    onCleanup(() => {
      motion.removeEventListener("change", changed)
      document.removeEventListener("visibilitychange", changed)
    })
  })
  onCleanup(cancel)
  return { phase, values, observe, cancel }
}

function energyStyle(value: number | null | undefined): JSX.CSSProperties {
  const amount = value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value))
  return {
    "--quota-value": String(amount / 100),
    "--liquid-level": `${100 - amount}%`,
    "--energy-strength": String(0.28 + amount / 140),
    "--energy-opacity": String(0.24 + amount / 160),
  }
}

export function QuotaOrb(props: { value: number | null | undefined; label: string; text: string; phase: ChargePhase }) {
  return (
    <span
      class="quota-orb"
      data-level={quotaLevel(props.value)}
      data-charge={props.phase === "fullPulse" && (props.value ?? 0) < 100 ? "settle" : props.phase}
      style={energyStyle(props.value)}
    >
      <span class="quota-orb-aura" aria-hidden="true" />
      <span class="quota-orb-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span class="quota-orb-shell" aria-hidden="true">
        <span class="quota-orb-core" />
        <span class="quota-orb-liquid">
          <span />
        </span>
        <span class="quota-orb-refraction" />
        <span class="quota-orb-highlight" />
        <span class="quota-orb-shadow" />
      </span>
      <span class="quota-orb-content">
        <span class="quota-orb-label">{props.label}</span>
        <span class="quota-orb-number">{props.text}</span>
      </span>
      <span class="quota-orb-ring" aria-hidden="true" />
      <span class="quota-orb-sparks" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  )
}

export function EnergyProgressBar(props: { value: number | null | undefined; label: string; phase: ChargePhase }) {
  return (
    <div
      class="energy-track"
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.value == null ? undefined : Math.round(props.value)}
      data-level={quotaLevel(props.value)}
      data-charge={props.phase === "fullPulse" && (props.value ?? 0) < 100 ? "settle" : props.phase}
      style={energyStyle(props.value)}
    >
      <div
        class="energy-fill"
        style={{ width: `${props.value == null ? 0 : Math.max(0, Math.min(100, props.value))}%` }}
      >
        <span class="energy-fill-glow" />
        <span class="energy-fill-core" />
        <span class="energy-fill-flow" />
        <span class="energy-fill-sweep" />
        <span class="energy-fill-head" />
      </div>
    </div>
  )
}

export function QuotaPanel(props: {
  children: JSX.Element
  style: JSX.CSSProperties
  phase: ChargePhase
  paused: boolean
}) {
  return (
    <section class="muc-status-scope quota-panel-anchor" style={props.style} data-energy-paused={props.paused}>
      <div class="quota-panel" data-charge={props.phase}>
        {props.children}
      </div>
    </section>
  )
}
