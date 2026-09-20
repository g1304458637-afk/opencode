// MUC Harness: muc://connect 深链 + 凭据 IPC。
// 渲染层通过这些通道查询连接状态、发起连接、断开账户、查询余额用量、
// 查询新版本自检结果。新版本只"提示"不自动安装（manifest 源固定为官方网关）。

import { app, dialog, ipcMain, Notification, shell } from "electron"
import { MucSecretStore } from "./secret-store"
import { MucConnectController } from "./controller"
import { parseMucUrl } from "./deep-link"
import { isMucExchangeError } from "./controller"
import { fetchMucUsage } from "./usage"
import {
  checkMucUpdate,
  MUC_DOWNLOAD_PAGE,
  MUC_UPDATE_CHECK_TTL_MS,
  type MucUpdateCheckResult,
} from "./update-check"

export type MucDeps = {
  getPendingConnectCode: () => string | null
}

// ---- 新版本自检：结果缓存 + 启动延迟广播 ----
let updateCache: { at: number; result: MucUpdateCheckResult } | null = null
let updateInFlight: Promise<MucUpdateCheckResult> | null = null
let announcementScheduled = false

async function checkMucUpdateCached(): Promise<MucUpdateCheckResult> {
  const localVersion = app.getVersion()
  if (updateCache && Date.now() - updateCache.at < MUC_UPDATE_CHECK_TTL_MS) {
    return updateCache.result
  }
  if (!updateInFlight) {
    updateInFlight = checkMucUpdate(localVersion)
      .then(result => {
        updateCache = { at: Date.now(), result }
        return result
      })
      .finally(() => {
        updateInFlight = null
      })
  }
  return updateInFlight
}

// 启动 15s 后自检一次：有新版发系统通知（点击打开 /muc），
// 低于 minSupported 弹强制升级对话框（每次启动都会出现，直到升级）。
// 全程 fire-and-forget，任何失败静默——不阻塞启动、不打扰用户。
function scheduleMucUpdateAnnouncement(): void {
  if (announcementScheduled) return
  announcementScheduled = true
  setTimeout(() => {
    void checkMucUpdateCached()
      .then(async result => {
        if (result.status === "forced" && result.manifest) {
          dialog.showMessageBoxSync({
            type: "warning",
            title: "mucode 需要更新",
            message: `当前版本 ${result.localVersion} 已低于最低支持版本 ${result.manifest.minSupported}`,
            detail: "网关协议已变更，当前版本可能无法正常使用，请下载新版本覆盖安装。",
            buttons: ["去下载新版本"],
            defaultId: 0,
            cancelId: 0,
          })
          await shell.openExternal(MUC_DOWNLOAD_PAGE)
          return
        }
        if (result.status !== "update-available" || !result.manifest || !Notification.isSupported()) return
        const notes = result.manifest?.notes
        const notification = new Notification({
          title: `mucode 有新版本 ${result.manifest.version}`,
          body: notes ? notes.slice(0, 180) : "点击查看下载页",
          silent: true,
        })
        notification.on("click", () => {
          void shell.openExternal(MUC_DOWNLOAD_PAGE)
        })
        notification.show()
      })
      .catch(() => {})
  }, 15_000)
}

export function registerMucIpcHandlers(userDataDir: string, deps: MucDeps): MucConnectController {
  const store = new MucSecretStore(userDataDir)
  const controller = new MucConnectController(store)

  ipcMain.handle("muc:get-state", async () => {
    return controller.restoreToProcessEnv()
  })

  ipcMain.handle("muc:connect", async (_event, code: unknown) => {
    if (typeof code !== "string" || !parseMucUrl(`muc://connect?code=${code}`)) {
      return { ok: false, error: "invalid_code" as const }
    }
    try {
      const { state, modelCount } = await controller.connect(code)
      return { ok: true, state, modelCount }
    } catch (error) {
      if (isMucExchangeError(error)) {
        return { ok: false, error: error.reason }
      }
      return { ok: false, error: "unknown" as const }
    }
  })

  ipcMain.handle("muc:disconnect", async () => {
    return controller.disconnect()
  })

  ipcMain.handle("muc:pending-code", () => deps.getPendingConnectCode())

  // 余额/用量：凭据只在此处解密使用，渲染层仅拿到聚合结果
  ipcMain.handle("muc:get-usage", async () => {
    const cred = await store.get()
    if (!cred) return { ok: false as const, error: "not_connected" as const }
    const usage = await fetchMucUsage(cred.gateway, cred.apiKey, app.getVersion())
    if (!usage) return { ok: false as const, error: "unavailable" as const }
    return { ok: true as const, usage }
  })

  // MUC Harness: 新版本自检（渲染层轮询；带 30min 缓存与去重）
  ipcMain.handle("muc:get-update", async () => {
    try {
      const result = await checkMucUpdateCached()
      if (result.status === "forced" && result.manifest) {
        return {
          available: true as const,
          forced: true,
          version: result.manifest.version,
          notes: result.manifest.notes,
          releasedAt: result.manifest.releasedAt,
        }
      }
      if (result.status === "update-available" && result.manifest) {
        return {
          available: true as const,
          forced: false,
          version: result.manifest.version,
          notes: result.manifest.notes,
          releasedAt: result.manifest.releasedAt,
        }
      }
      return { available: false as const }
    } catch {
      return { available: false as const }
    }
  })

  ipcMain.handle("muc:open-download-page", async () => {
    await shell.openExternal(MUC_DOWNLOAD_PAGE)
  })

  scheduleMucUpdateAnnouncement()

  return controller
}
