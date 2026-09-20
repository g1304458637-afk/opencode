# MUC Harness: mucode 自动更新与发布 Runbook（feat/muc-auto-update）

> 适用：muc 渠道（`OPENCODE_CHANNEL=muc`，appId `cn.edu.muc.harness`，productName `mucode`）。
> 基线：OpenCode upstream v1.18.31 fork（分支 `muc-harness`）；MUC 桌面版本独立 SemVer，起始 `2.0.0`。

## 0. 更新模型（不可动摇的两条线）

```
OpenCode upstream → MUC：人工审核、人工同步（git fetch upstream + rebase upstream/dev）
MUC Release  → MUC 用户：自动检查、自动下载、用户确认安装（electron-updater）
```

- **禁止**任何 "OpenCode upstream 自动进入 MUC 生产" 的机制：无 scheduled upstream sync、
  无 repository_dispatch、无 npm latest 依赖。自动更新 feed 只发布已经进入
  `muc-harness` 并通过测试的代码。
- MUC runtime 永远强制 v1（dist/node 内嵌 sidecar，`src/main/index.ts` `SIDECAR_VERSION`），
  `resources/opencode-cli` 在 muc 渠道不执行。更新系统不得改变该约束。

## 1. 版本策略（Phase 1）

| 项 | 值 | 说明 |
|---|---|---|
| MUC 版本唯一真实来源 | `packages/desktop/resources/muc/release.json` | 与上游解耦，rebase 不冲突 |
| 当前 MUC 版本 | `2.0.0` | > 已装基线 1.18.31，更新器判定为升级 |
| OpenCode 源码版本 | 1.18.31（fork 基线） | 仅随人工 rebase 变化 |
| 引擎内嵌版本 | `0.0.0-muc-<时间戳>` | dist/node 构建期 define，与桌面版本无关 |

版本派生链（全部自动，无需手工同步）：

```
release.json
  ├─ prebuild（syncMucVersionToPackageJson）→ package.json version → 渲染层 pkg.version（UI 显示）
  ├─ electron-builder extraMetadata.version → Info.plist CFBundleShortVersionString
  │                                        → asar package.json（Windows app.getVersion()）
  │                                        → latest*.yml 的 version
  │                                        → 版本化产物名 mucode-${version}-*
  └─ app.getVersion()（打包后）＝ electron-updater currentVersion
```

禁止手工改 package.json 的 version（prebuild 会以 release.json 覆盖之）。

## 2. 更新源（Phase 2/3）

- provider：`generic`（无账号、无 token），配置在 `electron-builder.config.ts` muc 分支。
- 基址：`https://admin.wuxuexi.top/downloads/muc-updates/stable`
- 客户端实际 feed（由 electron-builder 按产物展开 `${platform}/${arch}` 写入 app-update.yml）：
  - `.../stable/darwin/arm64/latest-mac.yml`
  - `.../stable/darwin/x64/latest-mac.yml`
  - `.../stable/win32/x64/latest.yml`
- 检查频率：启动后延迟 15s 首检 + 每 10 分钟；发现新版自动下载（SHA512 校验），**安装必须用户确认**。
- 逃生门：`MUC_DISABLE_AUTO_UPDATE=1` 环境变量可完全关闭（故障回退时让用户禁用检查）。
- 本地/E2E 覆盖：构建时 `MUC_UPDATE_FEED_URL=http://127.0.0.1:<port>/muc-updates/stable`。

## 3. 服务器目录布局（Phase 4/5）

```
/srv/sub2api/data/downloads/            ← /downloads 静态直供（nginx→容器 /app/data）
├── mucode-mac-arm64.dmg                ← 人工首装别名（无版本名，每次发布覆盖）
├── mucode-mac-x64.dmg
├── mucode-win-x64.exe
├── SHA256SUMS.txt
└── muc-updates/stable/                 ← 自动更新 feed（版本化文件名，永不覆盖）
    ├── darwin/arm64/
    │   ├── latest-mac.yml              ← 最后上传
    │   ├── mucode-<v>-mac-arm64.zip
    │   └── mucode-<v>-mac-arm64.zip.blockmap
    ├── darwin/x64/
    │   ├── latest-mac.yml
    │   ├── mucode-<v>-mac-x64.zip
    │   └── mucode-<v>-mac-x64.zip.blockmap
    └── win32/x64/
        ├── latest.yml
        ├── mucode-<v>-win-x64.exe
        └── mucode-<v>-win-x64.exe.blockmap
```

两个 mac 架构目录各自持有 latest-mac.yml，互不覆盖；electron-updater 按 app-update.yml
中展开后的 feed URL 精确命中自己的架构目录（MacUpdater 另有 arm64 文件过滤兜底）。

## 4. 发布流程（Phase 7/11，全部经 `scripts/muc-release.ts`）

```bash
cd packages/desktop

# 1) 版本 bump（严格递增，SemVer）
bun scripts/muc-release.ts bump 2.0.1

# 2) 构建 + 本地校验（build 含 dist/node 重建；verify 校验 Info.plist / app-update.yml /
#    latest*.yml / 版本化产物 / SHA256，产出 dist/muc-release-manifest.json）
OPENCODE_CHANNEL=muc bun scripts/muc-release.ts build mac-arm64
OPENCODE_CHANNEL=muc bun scripts/muc-release.ts build mac-x64
OPENCODE_CHANNEL=muc bun scripts/muc-release.ts build win-x64   # 需 Rosetta（makensis）

# 3) 上传（原子顺序内建；先 dry-run 检查计划，再 --execute）
bun scripts/muc-release.ts upload                # dry-run
bun scripts/muc-release.ts upload --execute      # payload → 远端校验 → manifest → 别名
```

`upload --execute` 的固定顺序（脚本内不可调换）：

1. rsync 版本化 payload（zip/exe/blockmap）→ `muc-updates/stable/<platform>/<arch>/`
2. ssh 远端 `sha256sum` + `stat` 与本地 manifest 逐项比对
3. **最后** scp `latest-mac.yml` / `latest.yml`（manifest 出现的那一刻，其引用的文件必然已完整存在）
4. 刷新 `/downloads` 人工下载别名（固定文件名覆盖）+ 重新生成 `SHA256SUMS.txt`

## 5. 客户端体验（Phase 6）

```
启动 → 15s 后后台检查（不阻塞启动）→ 发现新版 → 自动后台下载
    → 原生对话框："已下载更新 2.0.1。是否立即重启？" [重启] [稍后]
       ├─ 重启 → controller.install() → quitAndInstall（Squirrel.Mac 换包并自动重开）
       └─ 稍后 → 继续使用；正常退出后自动安装（muc 渠道 autoInstallOnAppQuit=true，
                 updater.ts），下次启动即新版本；同一会话同版本只弹一次
```

- 设置 → 关于 → "检查更新" 按钮（复用现有 renderer updater UI / `updater-action`）。
- 状态机复用 `updater-controller`：`disabled / idle / checking / downloading(percent) / ready /
  up-to-date / installing / error`，经 `updater-subscribe` IPC 推送到渲染层。
- 网络失败：后台检查只记日志不弹窗；手动检查才显示错误对话框。

## 6. 签名现状（Phase 0 审计，2026-09-20）

```text
macOS signed:      ad-hoc（identity:null + scripts/after-sign-mac.js；无 Developer ID）
macOS notarized:   否（spctl rejected）
Windows signed:    否（signAndEditExecutable:false；sign 脚本仅 GITHUB_ACTIONS 生效）
```

**MAC_AUTO_UPDATE_BLOCKED_BY_SIGNING**：ad-hoc 签名下 electron-updater 本体不做签名校验
（`verifyUpdateCodeSignature` 仅 Windows NSIS 路径），SHA512 由 latest-mac.yml 保证；
但 Squirrel.Mac 原生安装器对 ad-hoc 更新包的行为未获正式支持保障，且无公证的首装
Gatekeeper 体验依赖 `xattr -cr` 修补。macOS 自动更新在拿到 Developer ID + notarization
之前，**不得对师生承诺生产可用**；Phase 9 E2E 的实测结论见 §8。

## 7. 回滚与坏版本（Phase 10）

- electron-updater 版本判定**单调递增**：`2.0.1` 已发布后严禁覆盖重发同名版本（哈希变化
  会导致已装用户永远校验失败/或拒绝降级）。修复 = 发布 `2.0.2`。
- 需紧急止血：把服务器上 `latest*.yml` 回退为指向上一个已发布版本目录的上一份 manifest
  （feed 目录按版本留档），或将 feed 暂时 404（客户端停止检查并静默记日志）。
- **staged rollout**：electron-updater 原生支持在 `latest*.yml` 中写 `stagingPercentage: 10`
  （源码 `AppUpdater.js` 按 `X-User-Staging` cookie 随机分桶）。Phase 1 不启用；未来灰度
  只需在步骤 3 的 manifest 里加一行，无需客户端改动。

## 8. E2E 验证记录（Phase 9）

见验收报告（本文件提交时的 commit message 与会话验收报告）。
每次正式发布前至少复跑 §4 步骤 2 的 verify + mac-arm64 更新演练。

## 9. 红线检查表（每次发布前过一遍）

- [ ] 本次发布代码已进入 `muc-harness`（或经验收的 feature 分支），非 upstream 直接产物
- [ ] 无新增 upstream 自动同步（rg `git pull upstream|git fetch upstream` 仅出现在 runbook 文档）
- [ ] `SIDECAR_VERSION` muc 强制 v1 逻辑未动（`index.ts`）
- [ ] 客户端内无 token/secret（`rg "sk-|TOKEN|SECRET" packages/desktop/resources/muc`）
- [ ] `MUC_UPDATE_FEED_URL` 未在正式构建时指向测试地址（verify 步骤会打印 app-update.yml 里的 feed）
- [ ] manifest 最后上传
