# Reward Motion QA

> 2026-09-29 用户截图确认：默认改为 **MAX / 0.5×**，粒子160、溢光1.9、冲击波1.6、画面冲击4；音效默认关闭。实际主动画时长为全额重置5.2秒、重置卡4.6秒。下方 High / 1× 的数值和验证为此前版本记录，时间轴内部关键帧单位保持不变。

Current cinematic V2: [research](../../docs/REWARD_CINEMATIC_RESEARCH.md), [results](../../docs/REWARD_CINEMATIC_RESULT.md). Per the latest user instruction, keep the interactive local client and do not record videos. `verify.mjs` below is a historical V1 recording script; do not run it for this round.

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

The bottom-right **动效预览** panel has **获得重置卡**, **全额重置**, and **模拟使用重置卡**. It starts expanded, works offline, and can be collapsed/reopened. The use-card action plays a synthetic 20→100 quota and 3→2 card transition; at the default MAX / 0.5× speed it runs for 4.2 seconds. The other actions use synthetic 20→100 quota or 0→1 card snapshots. The orb temporarily labels its simulated value **预览额度**; account values return after playback. Closing cancels the preview and its confirmation. No account store writes, reward requests, card consumption, or grant API calls occur. Real reward receipts take precedence and cancel a preview. Both build flags are required; normal builds have no preview entry.

## Cinematic V2 controls and checks (no video)

The complete-client panel now provides Low / Medium / High / MAX (default **MAX / 0.5×**), 1× / 0.5× / 0.25×, particle count, bloom strength, shockwave strength, screen impact, Reduced Motion and opt-in reward sound. Advanced controls are disabled while playing; replay buttons restart their own preview. Production builds omit the panel; the production account panel retains the sound preference.

For isolated browser QA:

```sh
CAMPUS_REWARD_PREVIEW=1 OPENCODE_CHANNEL=hubu node_modules/.bin/vite --config e2e/reward-motion/vite.config.ts --port 4199
node e2e/reward-motion/cinematic.mjs
node e2e/reward-motion/preview.mjs
node e2e/reward-motion/matrix.mjs
```

`preview.mjs` checks all three preview actions, the 4.2-second default use-card presentation, unchanged real fixture quota/cards, no use-card IPC call, reduced motion, and Escape skip. `cinematic.mjs` checks High and MAX for both grant/reset events, slow motion, focus/draft preservation, exact restoration of account values, Reduced Motion, and AudioContext completion/cancellation. These checks write JSON and diagnostic stills under `e2e/artifacts/reward-cinematic`, with **no video recording**. The stills are engineering evidence; visual acceptance is interactive in the complete local client. Frame samples include a diagnostic screenshot and are not a stable-60fps certification.

For current native reward regression, build the local client with normal update URLs, compile `e2e/campus.ts` as above, then run:

```sh
OPENCODE_CHANNEL=hubu CAMPUS_E2E_REWARD=1 CAMPUS_E2E_SCOPE=quota CAMPUS_E2E_ARTIFACTS=e2e/artifacts/reward-cinematic-electron node e2e/artifacts/campus-run.mjs
```

This skips updater tests, which were checked in V1 and are unchanged. No videos are configured in this native harness.
