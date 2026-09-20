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
  ├─ electron.vite define（MUC_VERSION，仅 muc 渠道）→ 渲染层 UI 显示版本
  ├─ electron-builder extraMetadata.version → Info.plist CFBundleShortVersionString
  │                                        → asar package.json（Windows app.getVersion()）
  │                                        → latest*.yml 的 version
  │                                        → 版本化产物名 mucode-${version}-*
  └─ app.getVersion()（打包后）＝ electron-updater currentVersion
```

package.json 是 git tracked 源文件，构建流程**只读不写**（prebuild 不再改它）；
版本注入 = electron.vite define（渲染层）+ electron-builder extraMetadata.version（打包侧）。
自动一致性测试：`bun test packages/desktop/scripts/muc-version.test.ts`
（release.json == Info.plist == asar package.json == latest*.yml == 产物文件名；
并断言 prebuild 前后 `git status --porcelain` 完全一致）。

## 2. 更新源（Phase 2/3）

- provider：`generic`（无账号、无 token），配置在 `electron-builder.config.ts` muc 分支。
- 基址：`https://admin.wuxuexi.top/downloads/muc-updates/stable`
- 客户端实际 feed（由 electron-builder 按产物展开 `${platform}/${arch}` 写入 app-update.yml）：
  - `.../stable/mac/arm64/latest-mac.yml`
  - `.../stable/mac/x64/latest-mac.yml`
  - `.../stable/win/x64/latest.yml`
  （`${os}` 宏 = 目标平台键 mac/win；勿用 `${platform}`——那会展开成构建机的 darwin/win32，交叉打包必错）
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
    ├── mac/arm64/
    │   ├── latest-mac.yml              ← 最后上传
    │   ├── mucode-<v>-mac-arm64.zip
    │   └── mucode-<v>-mac-arm64.zip.blockmap
    ├── mac/x64/
    │   ├── latest-mac.yml
    │   ├── mucode-<v>-mac-x64.zip
    │   └── mucode-<v>-mac-x64.zip.blockmap
    └── win/x64/
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

## 6. 签名现状与正式签名准备（Production Hardening，2026-09-21）

```text
macOS signed:      ad-hoc（identity:null + scripts/after-sign-mac.js；无 Developer ID）
macOS notarized:   否（spctl rejected）
Windows signed:    否（signAndEditExecutable:false；无证书）
状态：             WAITING_FOR_APPLE_SIGNING_CREDENTIAL / WAITING_FOR_WINDOWS_SIGNING_CERT
```

**实测定论（2026-09-20 E2E）**：ad-hoc 更新在 check/download/SHA512/ready/Squirrel 交接
全部通过，最终被 Squirrel.Mac 拒绝：`Code signature ... did not pass validation`。
**不要尝试绕过 Squirrel 签名校验**；唯一正路 = 正式签名。

### 6.1 macOS 正式方案（目标态）

```
Developer ID Application + Hardened Runtime + notarization + stapling
```

- 代码已就绪：`electron-builder.config.ts` muc 分支双模式——设 `MUC_SIGN_IDENTITY`
  （或 `CSC_NAME`）即切换为 Developer ID 签名 + `notarize: true`（hardenedRuntime 恒开），
  且不再跑 ad-hoc afterSign 钩子；不设则保持 ad-hoc 测试模式。
- **所需 Apple 凭据清单**（全部经 Keychain / 环境变量 / CI secrets 注入，禁止入仓）：
  1. Apple Developer Program（Team ID）
  2. `Developer ID Application` 证书 + 私钥（导入构建机 Keychain，或 CI 以
     `CSC_LINK`/`CSC_KEY_PASSWORD` 注入；identity 名经 `MUC_SIGN_IDENTITY` 传入）
  3. 公证凭据二选一：`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`，
     或 App Store Connect API key（`APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`）
- entitlements 审计：`resources/entitlements.plist` = Electron 标准 JIT 套件
  （allow-jit / allow-unsigned-executable-memory / disable-library-validation /
  dyld-env-vars / disable-executable-page-protection）+ 麦克风；与 hardened runtime
  兼容，公证无冲突。bundle id：主程序 `cn.edu.muc.harness`，helper 自动派生
  `cn.edu.muc.harness.helper`，同一 Team ID 签名即可。
- 发布门（脚本内建）：`upload`（stable，非 `--test-feed`）强制
  `codesign verify` + `Authority=Developer ID Application` + `stapler validate`
  三关全过，否则直接失败、零上传。

### 6.2 Windows 正式方案（目标态）

- electron-builder 26 标准 signtool 接口：设 `WIN_CSC_LINK`（.pfx）+
  `WIN_CSC_KEY_PASSWORD`（或 `CSC_LINK`/`CSC_KEY_PASSWORD`）后自动启用
  `signtoolOptions` 签名 + exe/NSIS 元数据编辑（`signAndEditExecutable: true`）。
- 证书约束：`.pfx/.p12` 与密码只走环境变量/CI secrets；EV/硬件 token 证书需在
  真实 Windows 构建机上签名（signtool 无法在 mac 交叉执行）。
- 一致性：exe publisher、NSIS installer publisher、electron-updater 下载后校验
  （latest.yml `publisherName` ↔ 签名证书）将自动统一为同一 Publisher。
- 发布门：`upload` stable 在 win32 上运行 `signtool verify /pa /all`；mac 交叉构建
  无法验证 → 直接拒绝发布 stable。

### 6.3 Keychain "mucode Safe Storage" 弹窗归因（#5）

```text
adhoc build:         每次重装 CDHash/designated requirement 变化 → Keychain ACL 失配
                     → 首次访问 safeStorage 弹 "mucode Safe Storage" 授权框（等输入，
                     期间相关启动流程阻塞）；Allow 后本次有效，下次重装再来。
Developer ID build:  designated requirement 稳定（Team ID 锚定）→ 首次 Allow/Always Allow
                     之后，签名更新替换 bundle 不再触发弹窗。
```

处理原则：不为消除弹窗删除用户 Keychain 数据或弱化 safeStorage 策略；正式签名后复测。

## 6.5 Native 依赖架构防线（node-pty 事件复盘）

事故（2026-09-21 x64 Rosetta E2E 实测）：`mucode-x64.app` 启动即崩——
`Failed to load native module: pty.node ... Cannot find module:
./prebuilds/darwin-x64/pty.node`。x64 包内被打入 `@lydell/node-pty-darwin-arm64`，
其 JS 在 x64 运行时找不到 darwin-x64 prebuild。

根因链（两处叠加）：
1. `electron.vite.config.ts` 把 node-pty 平台包按**构建机** `process.arch`
   externalize 进主 bundle → arm64 机打的 x64 包 require 了 darwin-arm64 包。
   修复：`MUC_PTY_PKG` 环境变量按打包目标注入（release 脚本设置）。
2. bun 默认安装**全部**平台 optionalDependencies → electron-builder 的
   files 过滤对自动收集的 node_modules 无效（实测）→ 各平台包全进包。
   修复：`pruneNativePackages` 打包前物理裁剪非目标平台包（bun install 恢复）。

防线：`verifyBuild` 的 **native arch gate**——遍历包内全部 `.node` +
主执行档，`lipo/file` 判定架构：mac-arm64 要求 arm64、mac-x64 要求 x86_64
（universal 允许）、win 要求 PE32+；并断言错误架构的 darwin 平台包目录为 0。
任一不满足 → 构建判 FAILED，禁止进入发布。

## 7. 回滚与坏版本（Phase 10)

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
