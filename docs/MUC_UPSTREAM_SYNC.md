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

## mucode 自身更新（L2 已实现：版本自检提示，不自动安装）

muc 渠道 `UPDATER_ENABLED=false` 保持不变（不自动下载安装）。应用内已接入
"版本自检提示"：

- **版本号**：打包版本 = `<package.json 版本>-muc.<MUC_BUILD>`（见
  `electron-builder.config.ts`，发版时递增 `MUC_BUILD`），`app.getVersion()` 即该值。
- **版本源**：`https://admin.wuxuexi.top/downloads/latest-mucode.json`，由
  `packages/desktop/scripts/muc-manifest.mjs` 生成（字段 version / releasedAt /
  notes / minSupported / downloads{file,url,sha256,size}）。
- **客户端行为**（`src/main/muc/update-check.ts` 纯逻辑 + `muc/ipc.ts` 接线）：
  启动 15s 后拉取 manifest；有新版 → 系统通知（点击打开 /muc 页）；
  低于 `minSupported` → 强制升级对话框（每次启动出现，直到升级）；悬浮球挂
  "新"徽标、面板内提供"去下载"。`/v1/usage` 请求携带 `mucode/<版本>` UA 供服务端
  统计旧版滞留率。manifest 源固定为官方网关，不随用户配置的 gateway 变化。
- **网站端**：/muc 页（sub2api `MucView.vue`）读取同一 manifest 展示
  "最新版本"区块，manifest 缺失时区块整体隐藏。

### 发版 checklist（每次发新包）

1. 递增 `electron-builder.config.ts` 的 `MUC_BUILD`；若基于新上游，先完成 rebase 与必检门。
2. 三平台打包：`OPENCODE_CHANNEL=muc bun run build && bun run package:mac -- --arm64` /
   `-- --x64` / `bun run package:win`。
3. `node scripts/muc-manifest.mjs --dist dist --notes "…" [--min-supported x.y.z-muc.n]`
   （缺平台产物会告警；需要强制升级时才设置 minSupported）。
4. 上传 dist 安装包 + `SHA256SUMS` + `latest-mucode.json` 到生产 `/downloads/`。
5. 验证：/muc 页版本区块展示新版本；客户端悬浮球"新"徽标与系统通知可触发。
6. 用 admin 站内公告系统发一条更新说明。

### L3（electron-updater 自动更新，暂缓）

仍按原计划：等 Apple Developer 签名体系补齐后对 mac 打开 updater（generic
provider 指向 /downloads + latest.yml）；Windows 可先行（需先补 exe 版本资源）。
