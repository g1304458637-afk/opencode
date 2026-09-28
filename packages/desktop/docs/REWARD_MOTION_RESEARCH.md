# Reward Motion audit and design decisions — 2026-09-29

## Verified baseline

Workspace: `/Users/cccc/Desktop/共用/opencode-hubu-logo-20260928`.
Branch: `feat/reward-motion-system`; base: `1cbfa6bfc63893165194c43779bc1e8300d02f75`.
Read-only `git ls-remote fork refs/heads/hubu-main` confirmed this remote head during the task.
The initial release head `c5b889f1cb` has the identical tree (`f8cb0aafd46fbb0255fde089c8c3fd1afc9b2445`). The branch was fast-forwarded to the merge head. Version comes from `resources/hubu/release.json`: 2.1.0.

The pre-existing browser at port 4486 was `e2e/quota-visual/vite.config.ts` in this same checkout, with a historical synthetic `localVersion: 2.0.7`. It was NOT the complete desktop UI. The installed `/Applications/HUBU AI.app` reported 2.0.9. No installed app was replaced. Source, fixture version, and installed binary must not be conflated.

## Reference research

- [Motion source](https://github.com/motiondivision/motion) and [animate / sequences](https://motion.dev/docs/animate): reviewed the distinction between the React API and platform-independent animation, absolute sequence offsets, easing, numeric interpolation, and cancellation. `motion/react`, AnimatePresence, useSpring/useTransform, and React layout hooks are not applicable directly to SolidJS. No Motion or Framer Motion dependency exists in the app/desktop package. No migration or second framework is introduced.
- [Motion Primitives animated-number source](https://github.com/ibelick/motion-primitives/blob/main/components/core/animated-number.tsx): reusable numeric progression with a single rendered value; adopted controlled interpolation and exact final values rather than random digits or staged hardcoded integers. React lifecycle/hook code was not copied.
- [Magic UI number-ticker](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/number-ticker.tsx), [particles](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/particles.tsx), [border-beam](https://magicui.design/docs/components/border-beam): inspected start/end numeric state, motion subscription cleanup, canvas refs, DPR sizing, alpha/velocity and RAF cancellation. Adopted number interpolation, thin perimeter treatment, a single foil sweep and bounded motes. Did not import the decorative presets, repeating effects or full UI library.
- [tsParticles container lifecycle](https://github.com/tsparticles/tsparticles/blob/main/engine/src/Core/Container.ts): explicit lifetime, hidden-state pause, cancellation, destroy/clear semantics. A canvas engine is disproportionate to 24/16 finite motes; compositor-driven DOM particles need no particle RAF, canvas allocation, resize listener or external engine.
- [Rive State Machine Playback](https://rive.app/docs/runtimes/state-machines), [inputs](https://rive.app/docs/runtimes/inputs), [React runtime](https://github.com/rive-app/rive-react): explicit event/state/transition separation informs the controller. No existing Rive runtime or .riv asset pipeline; adding one for two scenes offers no demonstrated benefit. The docs endpoint exposed only a lightweight shell in this research environment; no Rive implementation was executed.
- [Fluent motion](https://fluent2.microsoft.design/motion): purpose, physical continuity, hierarchy, bounded durations, staggered emphasis, accessibility. These drive restore-before-confirmation and artifact-before-inventory ownership transfer.
- [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion), [Reduce Motion API](https://developer.apple.com/documentation/uikit/uiaccessibility/isreducemotionenabled): honor the user's motion preference. Apple pages were partially JS-rendered; web implementation uses `matchMedia('(prefers-reduced-motion: reduce)')` and CSS, with runtime change handling. No flip/travel/motes in reduced mode; confirmation stays readable.

**Implementation choice:** SolidJS + finite CSS keyframes + one bounded presentation RAF. This follows the existing Solid/CSS stack and browser compositor architecture without installing dependencies. The pure timeline defines phases and authoritative-value interpolation; CSS percentages map to its 1650/1450 ms durations. The sole timeout belongs to the independently dismissible confirmation toast. This is a deliberate native alternative to Motion JS, not a claim that Motion React is in use. No vendor source was copied verbatim.

## Real reward flow

1. `/v1/usage` returns quota/subscription/reset-card state plus `reward_arrivals` receipts of committed grants/applications. The service contract is visible in adjacent `sub2api-reward-arrival/backend/internal/service/reward_arrival.go`; this is a source audit, not live production validation.
2. `src/main/muc/usage.ts` parses `reset_cards.available`, `subscription_status.short_window.remaining_percent`, `weekly_window.remaining_percent`, and receipts `{id,type,quantity,occurred_at,subscription_id?}`. Legacy weekly state uses `100 - weeklyUsagePercent`.
3. `src/main/muc/ipc.ts` collects new arrivals and persists account+gateway-scoped receipts through `campus.reward-arrivals` before IPC delivery. Initial feed is a silent baseline. Seven-day history/floor and 4096-receipt cap prevent replay. Reward ids use `card:` / `reset:` prefixes. No reward WebSocket/SSE exists in this path.
4. `MucStatus.refresh` polls every 30 seconds or on manual refresh/use-card acknowledgement. A successful snapshot is the authority. Existing reset-card API and acknowledgement order are preserved. Failed refresh cancels the presentation and marks the account stale.
5. The controller gets before/after snapshots and validated receipts. Full-reset subscription id must match the visible subscription; missing new quota/count never yields success animation. Changing balances without a receipt does not invent a reward.
6. The quota orb, account popover, quota bars, and card inventory are in `muc-status.tsx` / `quota-energy.tsx`. The real composer is targeted through its DOM component marker; geometry is verified in the full Electron run.

## Queue, state, truth and lifecycle

`RewardEvent`: stable id + original id list, type, createdAt, source, before/after payload. S/A/B tier metadata reserves ordinary rewards as low priority; only FULL_RESET and RESET_CARD_GRANTED currently have scenes. Queue priority is 100 > 80; gap is 200 ms. Waiting cards aggregate; new cards arriving before count completion merge into the current artifact without restarting geometry/time. Duplicates in the same delivery and repeated deliveries are discarded.

The renderer additionally keeps a bounded seen-id set. Main-process persistence is the durable dedupe authority. At-most-once delivery intentionally permits losing a celebration if a renderer crashes after the durable receipt claim; the underlying reward is never lost or modified. Receipt acknowledgement semantics were not changed.

Quota/count presentation is a temporary projection only. Store state is updated independently of animation and toast. Any newer authoritative snapshot supersedes stale interpolation. Unknown old values remain unknown/no invented origin. Values are clamped to quota bounds and end at the server value, including 83% or unchanged 100%.

One finite RAF handles phases and numeric presentation. Scene DOM/CSS is unmounted at completion, cancellation or backgrounding. Hidden windows settle current ownership immediately and do not replay the scene on return. Pending work resumes on return. Reduced-motion listeners and visibility listeners are removed on disposal; the independent toast timer is cleared on dismiss/disposal. Existing unrelated quota idle effects remain existing product behavior.

## Visual system

Full reset: 0–120 dim; 80 ms orb ignition; 180–430 vertical edge path from actual orb; 260–720 numeric restoration; 720 ms focused wave/motes; quiet hero confirmation; one bar sweep and composer outline; settle; final toast at 1650 ms. Hero placement uses the actual home heading and composer to avoid colliding with the current homepage.

Reset card: seed, glass/graphite plane, single Y reveal, metallic foil, 16 inward motes, receipt quantity, curved keyframe transfer to actual inventory (or closed-panel orb), landing pulse, real count interpolation, toast at 1450 ms. Brand mark and metal/text colors come from `resolveBrand`. No HUBU-only logo/color constants.

Every crossing coordinate is measured from current DOMRects; the source card and destination centers are measured before style writes. Geometry is frozen during one scene and measured again for the next. Overlays are portaled to body and pointer-transparent. Toast buttons alone accept pointers. No focus, chat scroll, layout or input mutation is performed by the animation.

Audio audit: existing app settings cover agent/permission/error sounds. There is no reward-specific preference. This change stays silent, so it cannot bypass mute or introduce an unexpected sound. No audio infrastructure or new binary assets were added.
