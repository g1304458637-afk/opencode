# Quota visual development fixture

From `packages/desktop`:

```sh
OPENCODE_CHANNEL=muc bunx vite --config e2e/quota-visual/vite.config.ts
```

Open http://127.0.0.1:4486. Optional initial state: `?quota=75`.
The fixture mounts the production `MucStatus` / `QuotaOrb` / `EnergyProgressBar` / `QuotaPanel` components with an in-memory IPC substitute. It never contacts an account or model provider. It is outside the desktop renderer entry and its Vite config refuses production builds.

Use 100 / 75 / 30 / 10 to preview real presentation states. These controls preserve the window epoch, so ordinary percentage changes must not charge. After selecting 10, click Reset preview: both fixture window epochs advance and quota increases to 100. The same production reset detector and animation run. Toggle stale verifies unknown-state rendering. The real panel's Use / Confirm flow also works against the local fixture.

For actual Electron / preload / main IPC verification, build the desktop and run:

```sh
OPENCODE_CHANNEL=muc CAMPUS_LOCAL_BUILD=1 bunx electron-vite build
OPENCODE_CHANNEL=muc CAMPUS_E2E_SCOPE=quota CAMPUS_E2E_VISUAL=1 bun run test:e2e:campus
```

Repeat with `OPENCODE_CHANNEL=hubu`. The existing E2E harness creates an isolated profile, local HTTP fixture, and recorded external-link boundaries. Screenshots and OS process CPU metrics go under `e2e/artifacts/<brand>` unless `CAMPUS_E2E_ARTIFACTS` is set.
