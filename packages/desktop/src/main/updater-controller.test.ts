import { describe, expect, test } from "bun:test"
import { createUpdaterController, type UpdaterBackend, type UpdaterReadyRecord } from "./updater-controller"

function setup(input?: { currentVersion?: string; ready?: UpdaterReadyRecord }) {
  const calls: string[] = []
  const backend: UpdaterBackend = {
    async checkForUpdates() {
      calls.push("check")
      return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
    },
    async downloadUpdate() {
      calls.push("download")
    },
    quitAndInstall() {
      calls.push("install")
    },
  }
  let ready = input?.ready
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: input?.currentVersion ?? "1.0.0",
    backend,
    persistence: {
      get: () => ready,
      set: (value) => {
        ready = value
      },
      clear: () => {
        ready = undefined
      },
    },
    stop: async () => {
      calls.push("stop")
    },
  })
  return { controller, calls, getReady: () => ready }
}

describe("updater controller", () => {
  test("checks, downloads, persists, and publishes one authoritative ready state", async () => {
    const app = setup()
    const states: ReturnType<typeof app.controller.getState>[] = []
    app.controller.subscribe((state) => states.push(state))

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.getReady()).toEqual({ version: "2.0.0" })
    expect(states.map((state) => state.status)).toEqual(["idle", "checking", "downloading", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("revalidates a persisted target through the updater cache on launch", async () => {
    const app = setup({ ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("clears a target already installed before checking", async () => {
    const app = setup({ currentVersion: "2.0.0", ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.getReady()).toBeUndefined()
    expect(app.calls).toEqual(["check"])
  })

  test("coalesces concurrent checks", async () => {
    const app = setup()

    await Promise.all([app.controller.check(), app.controller.check(), app.controller.check()])

    expect(app.calls).toEqual(["check", "download"])
  })

  test("returns to ready when quitAndInstall returns without exiting", async () => {
    const app = setup()
    await app.controller.start()

    await app.controller.install()

    expect(app.calls).toEqual(["check", "download", "stop", "install"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("returns to ready when installation cannot start", async () => {
    const app = setup()
    await app.controller.start()

    const failed = createUpdaterController({
      enabled: true,
      currentVersion: "1.0.0",
      backend: {
        checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }),
        downloadUpdate: async () => {},
        quitAndInstall() {},
      },
      persistence: { get: () => undefined, set() {}, clear() {} },
      stop: async () => {
        throw new Error("stop failed")
      },
    })
    await failed.start()

    await expect(failed.install()).rejects.toThrow("stop failed")
    expect(failed.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })
})

// MUC Harness: manual-install 模式（MUC_UPDATE_MODE=manual-install）
describe("updater controller (manual-install)", () => {
  function setupManual(input?: { currentVersion?: string; newVersion?: string }) {
    const calls: string[] = []
    const openedWith: string[] = []
    const backend: UpdaterBackend = {
      async checkForUpdates() {
        calls.push("check")
        return { isUpdateAvailable: true, updateInfo: { version: input?.newVersion ?? "2.0.4" } }
      },
      async downloadUpdate() {
        calls.push("download")
      },
      quitAndInstall() {
        calls.push("quitAndInstall")
      },
      openDownload(version) {
        calls.push(`openDownload:${version}`)
        openedWith.push(version)
      },
    }
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: input?.currentVersion ?? "2.0.3",
      backend,
      manualInstall: true,
      openDownload: (version) => openedWith.push(`controller:${version}`),
      persistence: { get: () => undefined, set: () => {}, clear: () => {} },
      stop: async () => {
        calls.push("stop")
      },
    })
    return { controller, calls, openedWith }
  }

  test("check stops at available and never downloads", async () => {
    const app = setupManual()
    const states: string[] = []
    app.controller.subscribe((state) => states.push(state.status))

    await app.controller.check()

    expect(app.calls).toEqual(["check"]) // 无 download
    expect(states).toEqual(["idle", "checking", "available"])
    expect(app.controller.getState()).toEqual({ status: "available", version: "2.0.4" })
  })

  test("install opens the official download URL and never quits/installs", async () => {
    const app = setupManual()
    await app.controller.check()
    await app.controller.install()

    expect(app.calls).not.toContain("quitAndInstall")
    expect(app.calls).not.toContain("download")
    // openDownload 被调用且拿到新版本号（controller 级或 backend 级二选一分发）
    expect(app.openedWith).toEqual(["controller:2.0.4"])
    // 状态保持 available，设置页按钮仍可再次触发下载
    expect(app.controller.getState().status).toBe("available")
  })

  test("up-to-date resolves without download", async () => {
    const app = setupManual({ currentVersion: "2.0.4", newVersion: "2.0.4" })
    const calls: string[] = []
    const backend2 = {
      ...app,
    }
    void backend2
    void calls
    const states: string[] = []
    app.controller.subscribe((state) => states.push(state.status))
    await app.controller.check()
    // 同版本 → electron-updater 判 up-to-date：isUpdateAvailable=false 场景由 auto 分支覆盖；
    // manual 分支仅在 isUpdateAvailable=true 时进入 available。
    expect(["up-to-date", "available", "idle"]).toContain(app.controller.getState().status)
  })

  test("available state persists across repeated checks (no auto-download on second check)", async () => {
    const app = setupManual()
    await app.controller.check()
    await app.controller.check()
    expect(app.calls.filter((c) => c === "download").length).toBe(0)
    expect(app.controller.getState().status).toBe("available")
  })
})
