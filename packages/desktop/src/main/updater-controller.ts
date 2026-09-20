import type { UpdaterState } from "@opencode-ai/app/updater"

export type { UpdaterState } from "@opencode-ai/app/updater"

export type UpdaterReadyRecord = { version: string }

export type UpdaterBackend = {
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null | undefined>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  // MUC Harness: manual-install 模式——用系统浏览器打开官方下载地址（代替自动下载/安装）
  openDownload?(version: string): void | Promise<void>
}

type UpdaterPersistence = {
  get(): UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>
  set(value: UpdaterReadyRecord): void | Promise<void>
  clear(): void | Promise<void>
}

export function createUpdaterController(input: {
  enabled: boolean
  currentVersion: string
  backend: UpdaterBackend
  persistence: UpdaterPersistence
  stop: () => Promise<void>
  log?: (message: string, data?: object) => void
  // MUC Harness: manual-install 模式（MUC_UPDATE_MODE=manual-install）——
  // check 停在 available（不 downloadUpdate / 不 quitAndInstall），
  // install() 转为 backend.openDownload(version)。缺省 false = 原自动安装行为。
  manualInstall?: boolean
  openDownload?: (version: string) => void | Promise<void>
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let pending: Promise<UpdaterState> | undefined
  const listeners = new Set<(state: UpdaterState) => void>()

  const transition = (next: UpdaterState) => {
    input.log?.("updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach((listener) => listener(state))
    return state
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "ready") return Promise.resolve(state)
    if (pending) return pending

    pending = (async () => {
      transition({ status: "checking" })
      const result = await input.backend.checkForUpdates()
      const version = result?.updateInfo?.version
      if (!result?.isUpdateAvailable || !version || version === input.currentVersion) {
        await input.persistence.clear()
        return transition({ status: "up-to-date" })
      }

      // MUC Harness: manual-install——发现新版本即停，交给用户手动下载安装
      if (input.manualInstall) {
        return transition({ status: "available", version })
      }

      transition({ status: "downloading", version })
      await input.backend.downloadUpdate()
      await input.persistence.set({ version })
      return transition({ status: "ready", version })
    })()
      .catch((error) =>
        transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  return {
    getState: () => state,
    subscribe(listener: (state: UpdaterState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    async start() {
      const ready = await input.persistence.get()
      if (ready?.version === input.currentVersion) await input.persistence.clear()
      return check()
    },
    check,
    async install() {
      // MUC Harness: manual-install——install 语义 = 打开官方下载地址（不进自动安装链）
      if (input.manualInstall) {
        if (state.status !== "available") throw new Error("Update is not available")
        const opener = input.openDownload ?? input.backend.openDownload
        if (!opener) throw new Error("manual-install mode requires openDownload backend")
        await opener(state.version)
        return
      }
      if (state.status !== "ready") throw new Error("Update is not ready to install")
      const version = state.version
      transition({ status: "installing", version })
      await input
        .stop()
        .then(() => {
          input.backend.quitAndInstall()
          transition({ status: "ready", version })
        })
        .catch((error) => {
          transition({ status: "ready", version })
          throw error
        })
    },
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>
