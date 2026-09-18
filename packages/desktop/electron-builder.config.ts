import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "opencode-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.opencode.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "opencode-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`

const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc" || raw === "hubu") return raw
  return "dev"
})()

// MUC Harness: 更新 feed 基址可被环境变量覆盖（本地 E2E 指向 127.0.0.1 的临时 feed）。
// 只影响 muc 渠道；prod/beta 的 GitHub publish 不受影响。
// #5 HTTPS 守卫：正式 feed 强制 https；仅允许 localhost/127.0.0.1 用 http（测试 feed）。
const MUC_UPDATE_FEED_BASE = (() => {
  const base = process.env.MUC_UPDATE_FEED_URL ?? "https://admin.wuxuexi.top/downloads/muc-updates/stable"
  const isLocalHttp = base.startsWith("http://") && /\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(base)
  if (base.startsWith("http://") && !isLocalHttp) {
    throw new Error(`MUC update feed must use https (got ${base}); localhost http is allowed for E2E only`)
  }
  return base
})()

// MUC Harness: MUC 版本唯一真实来源（resources/muc/release.json），与上游 OpenCode
// workspace 版本解耦。extraMetadata.version 写进 Info.plist / asar package.json /
// latest.yml / 产物文件名，保证 app.getVersion()（= electron-updater currentVersion）、
// macOS CFBundleShortVersionString、UI 显示版本、update feed 版本四方一致。
const mucVersion = (() => {
  if (channel !== "muc") return null
  const release = JSON.parse(
    readFileSync(path.join(packageDir, "resources", "muc", "release.json"), "utf8"),
  ) as { version?: unknown }
  if (typeof release.version !== "string") throw new Error("resources/muc/release.json: missing version")
  return release.version
})()

// 校园品牌档案镜像（node 侧 fs 读取，避免 TS 模块解析差异）
const brandOf = (id: string) =>
  JSON.parse(readFileSync(path.join(packageDir, "../brand/brands", id, "brand.json"), "utf-8")) as {
    appId: string
    appName: string
    protocolScheme: string
    downloads: { macArm: string; macIntel: string; win: string }
  }
const HUBU = brandOf("hubu")

const APP_IDS = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
  muc: "cn.edu.muc.harness",
  hubu: HUBU.appId,
} as const

const getBase = (appId: string): Configuration => ({
  artifactName:
    channel === "muc"
      ? "mucode-${os}-${arch}.${ext}"
      : channel === "hubu"
        ? "hubu-ai-${os}-${arch}.${ext}"
        : "opencode-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.opencode.desktop" becomes
  // "ai.opencode.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*", "!resources/opencode-cli*"],
  extraResources: [
    ...(channel === "dev" || channel === "muc" || channel === "hubu"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "OpenCode",
    schemes: ["opencode"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "OpenCode Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "OpenCode Beta",
        protocols: { name: "OpenCode Beta", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode-beta", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "opencode-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "muc": {
      // MUC Harness: 双模式签名。
      // - 默认（无凭据）：ad-hoc（identity:null + afterSign 钩子做 ad-hoc 签名），
      //   供本地/E2E 测试；Squirrel.Mac 会拒绝 ad-hoc 更新（已实测），
      //   即 MAC_AUTO_UPDATE_BLOCKED_BY_SIGNING / WAITING_FOR_APPLE_SIGNING_CREDENTIAL。
      // - 正式（设 MUC_SIGN_IDENTITY 或 CSC_NAME）：Developer ID 签名 + hardened runtime
      //   + notarize（公证凭据经 APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID 或
      //   App Store Connect API key 环境注入），不跑 ad-hoc afterSign 钩子。
      // 凭据只走环境变量/Keychain/CI secrets，仓库内禁止出现任何证书或密钥文件。
      const macSigningIdentity = process.env.MUC_SIGN_IDENTITY ?? process.env.CSC_NAME ?? null
      const winCertificate = process.env.WIN_CSC_LINK ?? process.env.CSC_LINK ?? null
      // MUC Harness: 目标平台/架构由 release 脚本经 MUC_PTY_PKG 注入（native 架构错配防线之一）
      const ptyTarget = (process.env.MUC_PTY_PKG ?? `@lydell/node-pty-${process.platform}-${process.arch}`)
        .replace("@lydell/node-pty-", "")
        .split("-")
      const ptyTargetPlatform = ptyTarget[0]!
      const ptyTargetArch = ptyTarget[1]!
      return {
        ...base,
        appId,
        productName: "mucode",
        // MUC Harness: 打包版本注入 1.18.31-muc.N（app.getVersion() 供更新自检与 UA 上报使用）
        extraMetadata: { ...base.extraMetadata, ...(mucVersion ? { version: mucVersion } : {}) },
        icon: "resources/muc/icon.icns",
        protocols: { name: "MUC Connect", schemes: ["muc", "opencode"] },
        // MUC Harness: muc 自有更新源（generic provider，无账号 token）。
        // 注意必须用 ${os}（目标平台键 mac/win，electron-builder 按产物展开）——
        // ${platform} 展开的是构建机 platform，交叉打包会带错 feed 目录。
        // 实际生成：.../stable/mac/arm64、.../stable/mac/x64、.../stable/win/x64。
        publish: {
          provider: "generic",
          url: `${MUC_UPDATE_FEED_BASE}/\${os}/\${arch}`,
        },
        ...(mucVersion ? { extraMetadata: { ...base.extraMetadata, version: mucVersion } } : {}),
        // MUC Harness: 目标平台/架构之外的原生平台包过滤（含唯一架构 .node，
        // 运行期按平台惰性加载，排除不影响目标平台）。与 pruneNativePackages 双保险。
        files: [
          ...base.files,
          ...(ptyTargetPlatform === "darwin"
            ? [
                `!node_modules/@lydell/node-pty-darwin-${ptyTargetArch === "arm64" ? "x64" : "arm64"}{,/**}`,
                `!node_modules/@parcel/watcher-darwin-${ptyTargetArch === "arm64" ? "x64" : "arm64"}{,/**}`,
                `!node_modules/@msgpackr-extract/msgpackr-extract-darwin-${ptyTargetArch === "arm64" ? "x64" : "arm64"}{,/**}`,
                "!node_modules/@lydell/node-pty-linux-*{,/**}",
                "!node_modules/@lydell/node-pty-win32-*{,/**}",
                "!node_modules/@parcel/watcher-linux-*{,/**}",
                "!node_modules/@parcel/watcher-win32-*{,/**}",
                "!node_modules/@msgpackr-extract/msgpackr-extract-linux-*{,/**}",
                "!node_modules/@msgpackr-extract/msgpackr-extract-win32-*{,/**}",
              ]
            : [
                "!node_modules/@lydell/node-pty-darwin-*{,/**}",
                "!node_modules/@parcel/watcher-darwin-*{,/**}",
                "!node_modules/@msgpackr-extract/msgpackr-extract-darwin-*{,/**}",
              ]),
        ],
        // MUC Harness: mac 产物全版本化（26.x 的 mac 无 target 级 artifactName，dmg/zip 共用）；
        // zip 供 latest-mac.yml 引用（feed 内永不覆盖），dmg 由发布脚本写 /downloads 固定名别名。
        mac: {
          ...base.mac,
          icon: "resources/muc/icon.icns",
          hardenedRuntime: true,
          entitlements: "resources/entitlements.plist",
          entitlementsInherit: "resources/entitlements.plist",
          artifactName: "mucode-\${version}-mac-\${arch}.\${ext}",
          ...(macSigningIdentity
            ? { identity: macSigningIdentity, notarize: true }
            : { identity: null, notarize: false }),
        },
        ...(macSigningIdentity ? {} : { afterSign: "scripts/after-sign-mac.js" }),
        dmg: { ...base.dmg, icon: "resources/muc/icon.icns" },
        // MUC Harness: 跨平台构建免 wine（exe 不内嵌图标/版本信息，v1 可接受）。
        // 正式 Windows 签名：设 WIN_CSC_LINK(.pfx) + WIN_CSC_KEY_PASSWORD（或 CSC_LINK/CSC_KEY_PASSWORD）
        // 后启用 signtool 签名与 exe 元数据编辑；无凭据时保持 unsigned（WAITING_FOR_WINDOWS_SIGNING_CERT）。
        win: {
          ...(winCertificate
            ? {
                signAndEditExecutable: true,
                signtoolOptions: {
                  certificateFile: winCertificate,
                  certificatePassword: process.env.WIN_CSC_KEY_PASSWORD ?? process.env.CSC_KEY_PASSWORD,
                  // MUC Harness: publisherName 写入 latest.yml，electron-updater NSIS 路径
                  // 安装前按此校验 Authenticode（同一 Publisher 全链一致）；未设则由证书主题推导
                  ...(process.env.WIN_PUBLISHER_NAME ? { publisherName: process.env.WIN_PUBLISHER_NAME } : {}),
                },
              }
            : { signAndEditExecutable: false }),
          target: [{ target: "nsis", arch: ["x64"] }],
          icon: "resources/muc/icon.ico",
        },
        nsis: {
          oneClick: true,
          installerIcon: "resources/muc/icon.ico",
          uninstallerIcon: "resources/muc/icon.ico",
          // MUC Harness: 更新 feed 引用版本化 exe；/downloads/mucode-win-x64.exe 由发布脚本写别名
          artifactName: "mucode-\${version}-win-\${arch}.\${ext}",
        },
      }
    }
    case "hubu": {
      return {
        ...base,
        appId,
        productName: HUBU.appName,
        icon: "resources/hubu/icon.icns",
        protocols: { name: "HUBU Connect", schemes: [HUBU.protocolScheme, "opencode"] },
        mac: { ...base.mac, icon: "resources/hubu/icon.icns", identity: null },
        afterSign: "scripts/after-sign-mac.js",
        dmg: { ...base.dmg, icon: "resources/hubu/icon.icns" },
        // 与 muc 一致：跨平台构建免 wine（exe 不内嵌图标/版本信息，v1 可接受）
        win: {
          signAndEditExecutable: false,
          target: [{ target: "nsis", arch: ["x64"] }],
          icon: "resources/hubu/icon.ico",
        },
        nsis: {
          oneClick: true,
          installerIcon: "resources/hubu/icon.ico",
          uninstallerIcon: "resources/hubu/icon.ico",
        },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "OpenCode",
        protocols: { name: "OpenCode", schemes: ["opencode"] },
        publish: { provider: "github", owner: "anomalyco", repo: "opencode", channel: "latest" },
        deb: { fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
        rpm: { packageName: "opencode", fpm: [metainfoFpm(appId), legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
