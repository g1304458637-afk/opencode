# Reward Motion QA

Run from `packages/desktop`, with repository dependencies installed:

```sh
OPENCODE_CHANNEL=hubu node_modules/.bin/vite --config e2e/reward-motion/vite.config.ts
```

Open http://127.0.0.1:4198. This is a **development-only synthetic account fixture** using the actual `MucStatus`, quota, reward controller, scene, and confirmation components. Its surrounding composer/model controls are test fixtures. It is not the complete desktop app or a production account. `main.tsx` refuses production execution; no production route imports it.

Controls support old/new short quota, weekly quota and card count; 1× / 0.5× / 0.25×; both event kinds; simultaneous rewards; three cards; duplicates; failed refresh/recovery; and reduced motion. Operating-system reduced motion also works. Open/close the real quota panel to switch the measured flight destination. Reset old state before replaying a scenario.

With the server running:

```sh
node e2e/reward-motion/verify.mjs
node e2e/reward-motion/matrix.mjs
```

Outputs are under `e2e/artifacts/reward-motion` (gitignored): five named WebM videos, reveal/settled screenshots, responsive screenshots, `results.json` and `matrix.json`. Videos are actual browser recordings, not authored video simulations. The numeric balances are synthetic fixtures.

## Complete desktop app regression

This drives a freshly built Electron renderer/preload/main process and a local HTTP usage/reset/update fixture, using an isolated temporary profile:

```sh
OPENCODE_CHANNEL=hubu CAMPUS_LOCAL_BUILD=1 HUBU_MANIFEST_URL=http://127.0.0.1:18765/downloads/latest-hubu-ai.json node_modules/.bin/electron-vite build
bun build e2e/campus.ts --target node --external @playwright/test --outfile e2e/artifacts/campus-run.mjs
OPENCODE_CHANNEL=hubu CAMPUS_E2E_REWARD=1 CAMPUS_E2E_ARTIFACTS=e2e/artifacts/reward-motion-electron node e2e/artifacts/campus-run.mjs
```

For MUC use `OPENCODE_CHANNEL=muc`, `MUC_MANIFEST_URL=http://127.0.0.1:18765/downloads/latest-mucode.json`, and a separate artifact directory. These loopback update URLs are test-build settings; do not distribute that build. Restore a normal HUBU build after cross-brand testing. `CAMPUS_E2E_VISUAL=1` additionally runs the existing quota, resize, drag, keyboard and idle-metrics checks. Tests do not install or replace the user's desktop app, call a production grant API, send a paid model request, or publish a release.

## Scope of evidence

Native Electron checks cover reward queue, persisted dedupe after reload, DOM destination equality, actual composer focus/draft, hero geometry, minimize/restore, reset-card use and retry ordering, subscription refresh, account navigation, model catalog and update checks. Browser checks cover the larger motion/value matrix, recordings, responsive sizes and DPR2 frame pacing. Neither establishes Windows native performance, production reward delivery, paid chat-generation correctness, or an exhaustive heap-leak proof. Run the same native suite on Windows before a cross-platform release.

## Clickable preview in the complete local desktop client

To show the two replay buttons in the actual client (not the browser QA shell):

```sh
OPENCODE_CHANNEL=hubu CAMPUS_LOCAL_BUILD=1 CAMPUS_REWARD_PREVIEW=1 node_modules/.bin/electron-vite build
OPENCODE_CHANNEL=hubu BRAND=hubu MUC_CDP_PORT=0 node_modules/.bin/electron .
```

The bottom-right **动效预览** panel has **获得重置卡** and **全额重置**. It starts expanded, works offline, and can be collapsed/reopened. Each click replays a separate presentation controller using explicitly synthetic 20→100 quota or 0→1 card snapshots. The orb temporarily labels its simulated value **预览额度**; account values return after playback. Closing cancels the preview and its confirmation. No account store writes, reward requests, card consumption, or grant API calls occur. Real reward receipts take precedence and cancel a preview. Both build flags are required; normal builds have no preview entry.
