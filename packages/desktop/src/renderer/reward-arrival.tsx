import { Show } from "solid-js"
import { Portal } from "solid-js/web"
import { resolveBrand } from "@opencode-ai/brand"
import { isSystemReward, type RewardArrival } from "../shared/reward-arrival"
import type { RewardMotionController } from "./reward-motion"
import type { ResetCardUseReceipt } from "./reward-motion-state"
import { t } from "./i18n"
import "./reward-arrival.css"

export function rewardCopy(event: RewardArrival | ResetCardUseReceipt) {
  if (event.type === "reset_card_used") return { title: t("reward.use.title"), body: t("reward.motion.resetBody") }
  if (isSystemReward(event)) return { title: t("reward.motion.restored"), body: t("reward.motion.resetBody") }
  return { title: t("reward.motion.cardTitle", { count: event.quantity }), body: t("reward.motion.cardBody") }
}
/** Confirmation only: dismissing a toast has no authority over data or the motion queue. */
export function RewardArrivalLayer(props: { controller: RewardMotionController; onDetails: () => void }) {
  const brand = resolveBrand()
  return (
    <Portal>
      <Show when={props.controller.confirmation()} keyed>
        {(event) => (
          <aside
            class="muc-status-scope reward-arrival"
            data-mode={event.type === "FULL_RESET" ? "system" : "card"}
            style={{ "--reward-gold": brand.colors.gold }}
          >
            <div class="reward-arrival-glass">
              <span class="reward-confirm-mark" aria-hidden="true">
                ↻
              </span>
              <div class="reward-arrival-copy" role="status" aria-live="polite" aria-atomic="true">
                <span class="reward-eyebrow" aria-hidden="true">
                  {t(
                    event.type === "RESET_CARD_USED"
                      ? "reward.use.label"
                      : event.type === "FULL_RESET"
                        ? "reward.system.label"
                        : "reward.card.label",
                  )}
                </span>
                <strong>{rewardCopy(event.payload.arrival).title}</strong>
                <p>{rewardCopy(event.payload.arrival).body}</p>
                <Show when={event.type !== "FULL_RESET"}>
                  <p>{t("reward.motion.held", { count: event.payload.after.cards ?? "—" })}</p>
                </Show>
              </div>
              <button
                class="reward-dismiss"
                type="button"
                aria-label={t("reward.action.dismiss")}
                onClick={props.controller.dismiss}
              >
                ×
              </button>
              <div class="reward-footer">
                <span>{t(event.type === "RESET_CARD_GRANTED" ? "reward.status.received" : "reward.status.full")}</span>
                <button type="button" onClick={props.onDetails}>
                  {t("reward.action.details")} ↗
                </button>
              </div>
            </div>
          </aside>
        )}
      </Show>
    </Portal>
  )
}
