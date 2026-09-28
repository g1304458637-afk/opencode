import { createSignal, onMount, Show, For } from "solid-js"
import type { MucUsageSnapshot } from "../preload/types"
import { RewardArrivalLayer } from "./reward-arrival"
import { RewardMotionLayer, type RewardMotionController } from "./reward-motion"
import { rewardFxPresets, rewardFxIntensities } from "./reward-fx"
import { rewardSoundEnabled, setRewardSoundEnabled } from "./reward-sound"
import { initI18n, t } from "./i18n"
import "./reward-preview.css"

function snapshot(value: number, cards: number): MucUsageSnapshot {
  const window = { remainingPercent: value, startsAt: null, resetsAt: null, exhausted: false }
  return {
    planName: "Preview",
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
    resetCardsAvailable: cards,
    subscriptionStatus: {
      id: -1,
      groupId: -1,
      displayName: "Preview",
      quotaPolicy: "dual_window_v1",
      shortWindow: window,
      weeklyWindow: window,
      weeklyUsagePercent: 100 - value,
      usageStatus: "normal",
      expiresAt: "2099-01-01T00:00:00Z",
      paygFallback: false,
    },
  }
}

/** Opt-in local build only. Synthetic snapshots never enter the account store or IPC. */
export function RewardPreview(props: { controller: RewardMotionController; busy: boolean; onStart: () => void }) {
  const [open, setOpen] = createSignal(true)
  const [ready, setReady] = createSignal(false)
  onMount(() => {
    void initI18n().then(() => setReady(true))
  })
  const play = (reset: boolean) => {
    if (props.busy) return
    props.onStart()
    props.controller.cancel()
    props.controller.dismiss()
    props.controller.receive(
      [
        {
          id: `preview:${crypto.randomUUID()}`,
          type: reset ? "global_reset_received" : "reset_card_received",
          quantity: 1,
          occurredAt: new Date().toISOString(),
          ...(reset ? { subscriptionId: -1 } : {}),
        },
      ],
      snapshot(20, 0),
      snapshot(reset ? 100 : 20, reset ? 0 : 1),
    )
  }
  const close = () => {
    props.controller.cancel()
    props.controller.dismiss()
    setOpen(false)
  }
  return (
    <Show when={ready()}>
      <RewardMotionLayer controller={props.controller} />
      <RewardArrivalLayer controller={props.controller} onDetails={() => setOpen(true)} />
      <aside class="reward-preview" aria-label={t("reward.preview.title")}>
        <Show
          when={open()}
          fallback={
            <button type="button" onClick={() => setOpen(true)}>
              {t("reward.preview.title")}
            </button>
          }
        >
          <div class="reward-preview-heading">
            <strong>{t("reward.preview.title")}</strong>
            <button type="button" onClick={close} aria-label={t("reward.preview.close")}>
              ×
            </button>
          </div>
          <p>{t("reward.preview.notice")}</p>
          <div class="reward-preview-actions">
            <button type="button" disabled={props.busy} onClick={() => play(false)}>
              {t("reward.preview.card")}
            </button>
            <button type="button" disabled={props.busy} onClick={() => play(true)}>
              {t("reward.preview.reset")}
            </button>
          </div>
          <fieldset class="reward-preview-controls" disabled={!!props.controller.active()}>
            <label>
              {t("reward.fx.intensity")}
              <select
                aria-label={t("reward.fx.intensity")}
                value={props.controller.fx().intensity}
                onChange={(event) => {
                  const value = rewardFxIntensities.find((option) => option === event.currentTarget.value)
                  if (value) props.controller.configureFx({ intensity: value, ...rewardFxPresets[value] })
                }}
              >
                <For each={rewardFxIntensities}>
                  {(value) => <option value={value}>{t(`reward.fx.${value}`)}</option>}
                </For>
              </select>
            </label>
            <label>
              {t("reward.fx.speed")}
              <select
                aria-label={t("reward.fx.speed")}
                value={props.controller.playbackSpeed()}
                onChange={(event) => props.controller.setSpeed(Number(event.currentTarget.value))}
              >
                <option value="1">1×</option>
                <option value="0.5">0.5×</option>
                <option value="0.25">0.25×</option>
              </select>
            </label>
            <details>
              <summary>{t("reward.fx.controls")}</summary>
              <label>
                {t("reward.fx.particles")} {props.controller.fx().particles}
                <input
                  type="range"
                  min="32"
                  max="160"
                  step="8"
                  value={props.controller.fx().particles}
                  aria-label={t("reward.fx.particles")}
                  onInput={(event) => props.controller.configureFx({ particles: Number(event.currentTarget.value) })}
                />
              </label>
              <label>
                {t("reward.fx.bloom")} {props.controller.fx().bloom}
                <input
                  type="range"
                  min="0"
                  max="2.5"
                  step="0.1"
                  value={props.controller.fx().bloom}
                  aria-label={t("reward.fx.bloom")}
                  onInput={(event) => props.controller.configureFx({ bloom: Number(event.currentTarget.value) })}
                />
              </label>
              <label>
                {t("reward.fx.shockwave")} {props.controller.fx().shockwave}
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={props.controller.fx().shockwave}
                  aria-label={t("reward.fx.shockwave")}
                  onInput={(event) => props.controller.configureFx({ shockwave: Number(event.currentTarget.value) })}
                />
              </label>
              <label>
                {t("reward.fx.impact")} {props.controller.fx().impact}
                <input
                  type="range"
                  min="0"
                  max="4"
                  step="1"
                  value={props.controller.fx().impact}
                  aria-label={t("reward.fx.impact")}
                  onInput={(event) => props.controller.configureFx({ impact: Number(event.currentTarget.value) })}
                />
              </label>
            </details>
            <label>
              <span>{t("reward.fx.reduced")}</span>
              <input
                type="checkbox"
                checked={props.controller.reduced()}
                onChange={(event) => props.controller.setReducedForQA(event.currentTarget.checked)}
              />
            </label>
          </fieldset>
          <label class="reward-preview-sound">
            <span>{t("reward.fx.sound")}</span>
            <input
              type="checkbox"
              checked={rewardSoundEnabled()}
              onChange={(event) => setRewardSoundEnabled(event.currentTarget.checked)}
            />
          </label>
          <div class="reward-preview-readings" aria-live="off">
            <span>
              {t("reward.preview.quota")}{" "}
              <b>
                {Math.floor(
                  props.controller.frame()?.quota[0] ?? props.controller.confirmation()?.payload.after.quota[0] ?? 20,
                )}
                %
              </b>
            </span>
            <span>
              {t("reward.preview.cards")}{" "}
              <b>×{props.controller.frame()?.cards ?? props.controller.confirmation()?.payload.after.cards ?? 0}</b>
            </span>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
