import { app, dialog, shell } from "electron"
import pkg from "electron-updater"
import { UPDATER_ENABLED, CHANNEL, MUC_UPDATE_MODE } from "./constants"
import { createUpdaterController, type UpdaterReadyRecord } from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { setAppQuitting } from "./windows"
import { nativeT } from "./native-translations"

const { autoUpdater } = pkg
const key = "ready"

// MUC Harness: manual-install 模式的官方下载地址映射（平台+架构 → /downloads 固定别名）
export function mucDownloadUrl(): string {
  const base = "https://admin.wuxuexi.top/downloads"
  if (process.platform === "darwin") return process.arch === "arm64" ? `${base}/mucode-mac-arm64.dmg` : `${base}/mucode-mac-x64.dmg`
  if (process.platform === "win32") return `${base}/mucode-win-x64.exe`
  return `${base}/muc`
}

const MANUAL_INSTALL = CHANNEL === "muc" && MUC_UPDATE_MODE === "manual-install"

export function setupAutoUpdater(stop: () => Promise<void>) {
  const logger = getLogger()
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  // MUC Harness: muc 渠道禁止降级（回滚策略=发更高修复版，非降级覆盖）；上游 prod/beta 维持 true
  autoUpdater.allowDowngrade = CHANNEL !== "muc"
  autoUpdater.autoDownload = false
  // MUC Harness: muc 渠道"稍后"语义 = 正常退出后静默安装（Phase 6 UX）；上游 prod/beta 维持 false
  autoUpdater.autoInstallOnAppQuit = CHANNEL === "muc"
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })

  const store = getStore("opencode.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    // MUC Harness: 当前产品策略 = manual-install（签名后经 MUC_UPDATE_MODE=auto-install 一键切回）
    ...(MANUAL_INSTALL ? { manualInstall: true } : {}),
    backend: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      // MUC Harness: manual-install——打开对应平台/架构的官方下载地址
      ...(MANUAL_INSTALL
        ? {
            openDownload: (version: string) => {
              const url = mucDownloadUrl()
              logger.log("MUC manual update: opening download URL", { version, url })
              void shell.openExternal(url)
            },
          }
        : {}),
      quitAndInstall: () => {
        // quitAndInstall closes all windows before emitting before-quit, so
        // flag the quit first to keep window ids persisted for restore.
        setAppQuitting()
        try {
          autoUpdater.quitAndInstall()
        } catch (error) {
          // The install failed and the app keeps running; clear the flag so
          // deliberate window closes prune ids again.
          setAppQuitting(false)
          throw error
        }
      },
    },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    stop,
    log: (message, data) => logger.log(message, data),
  })
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupAutoUpdater>, alertOnFail: boolean) {
  const state = await controller.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message", { version: app.getVersion() }),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  // MUC Harness: manual-install——发现新版本即提示下载安装（不进自动下载/安装链）
  if (state.status === "available") {
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.available.message", { version: state.version }),
      title: nativeT("desktop.updater.dialog.available.title", { version: state.version }),
      buttons: [nativeT("desktop.updater.dialog.download"), nativeT("desktop.updater.dialog.later")],
      defaultId: 0,
      cancelId: 1,
    }).then((response) => {
      if (response.response === 0) return controller.install()
      return undefined
    })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.ready.title"),
    buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await controller.install()
}
