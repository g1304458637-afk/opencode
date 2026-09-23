# Reward Arrival System

## User-facing modes

Only two meanings: `reset_card_received` is a stored card, available for later use; `global_reset_received` means an immediate reset has already been applied. Source (gift, admin, individual or bulk) does not change presentation. Cards arriving together merge quantities.

## Files and components

- `packages/desktop/src/shared/reward-arrival.ts`: wire validation, receipt deduplication, bounded retention, grouping and types.
- `packages/desktop/src/main/muc/usage.ts`: parse optional `reward_arrivals` from authenticated `/v1/usage`.
- `packages/desktop/src/main/muc/ipc.ts`: persist receipt claims in main process, partitioned by gateway/account and brand profile; only sanitized arrivals reach renderer.
- `packages/desktop/src/renderer/reward-arrival.tsx`: RewardToast, RewardCardVisual, SystemBanner, RewardArrivalLayer and createRewardArrivalAnimator.
- `packages/desktop/src/renderer/reward-arrival.css`: glass, scan, absorption flight and bounded pulse; reduced-motion static treatment.
- `packages/desktop/src/renderer/muc-status.tsx`: existing Orb/Panel/count integration and existing createResetChargeEffect reuse. No change to reset execution.
- `packages/desktop/src/renderer/i18n/{zh,en}.ts`: all `reward.*` copy. Other languages use existing English fallback.
- `packages/desktop/src/shared/reward-arrival.test.ts`, `packages/desktop/e2e/campus.ts`: contract, duplicate, merge, desktop flow and regression coverage.
- `packages/desktop/e2e/quota-visual/`: local development-only fixture controls, excluded from production build.

Backend companion checkout: `/Users/cccc/Desktop/共用/sub2api-reward-arrival`.
- `backend/internal/service/reward_arrival.go`: read-only account-scoped receipt service.
- `backend/internal/repository/reward_arrival_repo.go`: committed card grants and successful global-reset applications; ignores revoked/expired cards and skipped/failed reset applications.
- `backend/internal/handler/gateway_handler.go`: optional feed appended to existing authenticated usage response. Read errors leave quota response available.
- Corresponding service and real PostgreSQL integration tests.

## Real event flow

Existing backend ledger → authenticated usage response → validated feed → main-process persistent ID claim → bounded renderer queue → glass notification. Initial history establishes a silent baseline. Polling, renderer reload and app restart do not replay already claimed receipts. No inference from card balance changes. Immediate-reset receipt is matched to the active subscription, and charge animation additionally requires the returned quota to increase; animation stops at real returned values, never manufactured 100%.

The feed is bounded to the newest 100 receipts within seven days. Local receipt retention is seven days / 4096 IDs. Persistence precedes presentation: notifications are best-effort, at-most-once, not a durable inbox. A crash after claiming but before rendering can omit a notification; the actual card/reset remains in the backend ledger. Fresh installations silently baseline history. Disconnected clients older than the retention window do not replay old history. Existing servers without the optional feed retain normal quota UI and do not synthesize arrivals.

One visible notification at a time; active readable notification merges incoming matching events, queued categories merge, dismissal pauses between notices. Hidden documents pause timers; component disposal clears all timers. No focus calls, autofocus, modal blocker, particle library or permanent animation loop is added. Notification remains readable for about eight seconds and supports dismiss / open QuotaPanel.

## Extending

Add a canonical receipt type and authoritative backend source, validate its payload, define merge identity and localized copy, then select either card or system presentation. Only explicitly matched, confirmed quota increases may use the recharge effect. Add baseline/replay/merge tests before adding a new visual mode.

## Deployment boundary

These are local source changes. A production launch requires the backend optional feed and desktop updates for both brands; this task does not itself publish installation packages or deploy the server.

## Verification evidence

- Frontend targeted unit suite: 47 passing tests, 200 assertions (receipt baseline/replay/merge/parser, quota state and existing MUC services).
- MUCode and HUBUCode desktop typechecks passed.
- Both brand desktop main/preload/renderer production builds passed. Existing CLI distribution is reused; this does not claim a new CLI build.
- Native Electron, isolated local HTTP fixtures: MUCode 17 reward/regression checks; HUBUCode 22 checks including full Quota visual coverage. No model generation requests.
- Verified actual chat editor focus and draft survive receipt/absorption, details opens panel, reduced motion disables notification animations, receipt persistence survives renderer reload, and balance changes without a receipt do not notify.
- Captured 1200px-wide, 768×640, 420×600 and 1000×420 reward states. Low-height notification is compact and clear of the input card.
- Backend service tests and actual disposable PostgreSQL/Redis integration test passed, including account isolation, revoked-card and skipped-application exclusions. Containers were removed by the test harness.
- Lint for new production reward modules: zero errors/warnings; git diff whitespace check passed.

Evidence: `/Users/cccc/Desktop/共用/reward-arrival-review/`.
Local development preview: http://127.0.0.1:4486/ (fixture only, source cwd `opencode-quota-energy/packages/desktop`).
