// MUC Harness: muc://connect 深链 + 凭据 IPC。
// 渲染层通过这些通道查询连接状态、发起连接、断开账户、查询余额用量。

import { ipcMain, shell } from "electron"
import { randomUUID } from "node:crypto"
import { MucSecretStore } from "./secret-store"
import { MucConnectController } from "./controller"
import { parseMucUrl } from "./deep-link"
import { isMucExchangeError } from "./controller"
import { fetchMucUsage } from "./usage"

export type MucDeps = {
  getPendingConnectCode: () => string | null
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
    const usage = await fetchMucUsage(cred.gateway, cred.apiKey)
    if (!usage) return { ok: false as const, error: "unavailable" as const }
    return { ok: true as const, usage }
  })

  // 重置卡消费：与 Website POST /subscriptions/:id/reset-with-card 同一后端端点语义
  //（网关传输通道 POST /api/v1/muc/reset-with-card/:id，API Key 认证）。
  // 幂等键每次点击新生成；重置语义/限张/归属校验全部在服务端。
  ipcMain.handle("muc:reset-card", async (_event, subscriptionId: unknown) => {
    const cred = await store.get()
    if (!cred) return { ok: false as const, error: "not_connected" as const }
    if (typeof subscriptionId !== "number" || !Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      return { ok: false as const, error: "invalid_subscription" as const }
    }
    // 网关传输通道挂 /v1（与 /v1/usage 同栈；/api/v1 前缀是网站端 API）
      const url = cred.gateway.replace(/\/+$/, "") + `/v1/muc/reset-with-card/${subscriptionId}`
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      })
      const body = (await res.json().catch(() => null)) as any
      const payload = body?.data ?? body
      if (!res.ok || !payload?.weekly_period_ends_at) {
        const reason = String(payload?.reason ?? payload?.message ?? "unavailable")
        return { ok: false as const, error: reason }
      }
      return { ok: true as const, weeklyPeriodEndsAt: String(payload.weekly_period_ends_at) }
    } catch {
      return { ok: false as const, error: "network" as const }
    }
  })

  // 管理套餐：打开 Website Pricing（MUCODE 内不做支付）
  ipcMain.handle("muc:open-pricing", async () => {
    const cred = await store.get()
    if (!cred) return
    await shell.openExternal(cred.gateway.replace(/\/+$/, "") + "/pricing")
  })

  return controller
}
