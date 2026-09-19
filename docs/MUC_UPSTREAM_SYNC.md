# MUC Harness: 上游同步 Runbook

muc-harness 分支基于上游 anomalyco/opencode 的 `dev` 分支定制。本文档描述如何
持续、无损地拉取上游更新。

## 分歧面速览（2026-09-19 盘点）

- 定制提交：线性历史（无 merge），功能提交约 17 个 + 文档/新增若干
- 纯新增文件（零冲突）：`packages/opencode/src/provider/muc.ts`、
  `packages/app/src/muc-flag.ts`、`packages/desktop/src/main/muc/*`（7 个）、
  `src/renderer/muc-gate.tsx`、`src/renderer/muc-status.tsx`、
  `scripts/after-sign-mac.js`、`resources/muc/*`、`docs/*`
- 修改的上游共享文件（冲突高发区）：
  - `packages/desktop/src/main/index.ts`（多提交分片修改，最高风险）
  - `packages/opencode/src/provider/provider.ts`、`.../httpapi/handlers/provider.ts`
  - `electron-builder.config.ts`、`src/main/constants.ts`、preload 两文件、
    `src/renderer/index.tsx`
  - `packages/app/src/components/dialog-select-model*.tsx`、`settings*providers*.tsx`、
    `pages/new-session/new-session-view.tsx`
  - `packages/ui` logo/wordmark/theme、`packages/tui` 品牌文件
- 版本 bump 文件（30 个 package.json + bun.lock）：每次上游发版必然冲突，
  处理方式固定（见下），无需惊慌

## 同步步骤

```bash
git fetch upstream
git rebase upstream/dev
```

### 冲突处理规则

1. **版本 bump 文件**（`**/package.json`、`bun.lock`）：
   一律取上游版本（`git checkout --theirs` 或删除本地 bump 提交）。
   muc 构建版本号是日期生成的 `0.0.0-muc-<时间戳>`（OPENCODE_CHANNEL=muc 时由
   packages/script 自动生成），不依赖 package.json 里的版本。
   bump.lock 冲突时解决 package.json 后跑一次 `bun install` 重新生成。
2. **共享代码文件**：定制修改都带 `// MUC Harness:` 注释标记。
   三方合并时保留双方语义：上游重构了结构就把 MUC 块按新结构重放。
   改完在该文件内全局搜索 `MUC Harness` 确认每个标记点都还存在。
3. **`src/main/index.ts`**（历史最高风险文件）：MUC 修改点清单——
   `pendingMucConnectCode` 捕获、`getDeliveryWindow`/`flushPendingDeepLinks`、
   `browser-window-focus` 补发、`setAsDefaultProtocolClient("muc")`、
   `registerMucIpcHandlers`、`mucController.restoreToProcessEnv`、
   muc 强制 sidecar v1、APP_IDS/APP_NAMES 的 muc 项。rebase 后逐项核对。
4. **桌面 deep link / muc IPC**：跑一遍既有测试
   `packages/desktop/src/main/muc/deep-link.test.ts`，并做一次深链端到端。

### rebase 后必检（全部通过才能 push）

```bash
bun turbo typecheck          # 或分别跑各包 typecheck
cd packages/app && bun run test:unit
cd packages/desktop && bun run typecheck && bun run build   # 冒烟
# 打包冒烟（可选但发版前必做）：
cd packages/desktop && OPENCODE_CHANNEL=muc bun run build && bun run package:mac -- --arm64
```

### push 与发版

```bash
git push origin muc-harness --force-with-lease   # rebase 改写历史后必须 force-with-lease
```

然后按 `docs/PRODUCTION_DEPLOYMENT_REPORT.md` 重建三平台安装包并部署。

## 编码约定（降低未来冲突面）

- 新定制逻辑一律进**新文件**（`muc-*.ts` / `src/main/muc/*` 模式），
  不嵌入上游函数体
- 必须修改上游共享文件时：改动贴边（imports / JSX 包裹层 / 函数末尾），
  且每处都加 `// MUC Harness:` 注释标记
- UI 隐藏类定制统一走 `packages/app/src/muc-flag.ts` 的开关 + `<Show>` 包裹

## mucode 自身更新（现状与可选方向）

现状：muc 渠道 `UPDATER_ENABLED=false`，应用更新 = 师生从 /muc 页面下载新
安装包覆盖安装；opencode 核心随安装包一起更新（sidecar v1 内联）。

可选后续：electron-updater 自托管源——发版脚本生成 `latest.yml` 上传到
sub2api `/downloads/`，打包配置加 `publish: { provider: generic,
url: "https://admin.wuxuexi.top/downloads" }` 并对 muc 渠道打开 updater。
做之前需要解决 mac 包签名信任链（当前 ad-hoc，electron-updater 仍可下载
替换，但提示体验弱于正式签名）。
