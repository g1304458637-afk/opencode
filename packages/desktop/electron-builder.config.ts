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
  if (raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc") return raw
  return "dev"
})()

// MUC Harness: 更新 feed 基址可被环境变量覆盖（本地 E2E 指向 127.0.0.1 的临时 feed）。
// 只影响 muc 渠道；prod/beta 的 GitHub publish 不受影响。
const MUC_UPDATE_FEED_BASE =
  process.env.MUC_UPDATE_FEED_URL ?? "https://admin.wuxuexi.top/downloads/muc-updates/stable"

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

const APP_IDS = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
  muc: "cn.edu.muc.harness",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: channel === "muc" ? "mucode-${os}-${arch}.${ext}" : "opencode-desktop-${os}-${arch}.${ext}",
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
    ...(channel === "dev" || channel === "muc"
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
      return {
        ...base,
        appId,
        productName: "mucode",
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
        // muc 走自有校园分发渠道，无 Apple Developer 证书体系：
        // identity:null 跳过正式签名，afterSign 钩子做 ad-hoc 签名（避免 macOS 报"已损坏"），
        // 显式关闭公证，避免构建机存在 APPLE_ID 环境变量时 electron-builder 直接报错。
        // MUC Harness: mac 产物全版本化（26.x 的 mac 无 target 级 artifactName，dmg/zip 共用）；
        // zip 供 latest-mac.yml 引用（feed 内永不覆盖），dmg 由发布脚本写 /downloads 固定名别名。
        mac: {
          ...base.mac,
          icon: "resources/muc/icon.icns",
          identity: null,
          notarize: false,
          artifactName: "mucode-\${version}-mac-\${arch}.\${ext}",
        },
        afterSign: "scripts/after-sign-mac.js",
        dmg: { ...base.dmg, icon: "resources/muc/icon.icns" },
        // MUC Harness: 跨平台构建免 wine（exe 不内嵌图标/版本信息，v1 可接受）
        win: {
          signAndEditExecutable: false,
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
