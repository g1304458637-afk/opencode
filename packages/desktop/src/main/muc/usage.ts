// MUC Harness: 网关余额/用量拉取。
// 模式与 countGatewayModels 一致：主进程 fetch + Bearer + 超时，失败返回
// undefined（不阻塞主流程）。API Key 只存在于主进程内存，渲染层仅拿到聚合结果。

export type MucUsageRateWindow = {
  window: string
  limit: number
  used: number
  remaining: number
  resetAt?: string
}

export type MucUsageModelStat = {
  model: string
  requests: number
  cost: number
}

export type MucUsageSnapshot = {
  // 展示用归一化字段
  planName: string
  remaining: number | null // null = 无限额/未知
  unit: string
  mode: "quota_limited" | "subscription" | "wallet" | "unknown"
  todayCost: number
  todayRequests: number
  totalCost: number
  totalRequests: number
  expiresAt?: string
  // 明细（展开面板）
  quota?: { limit: number; used: number; remaining: number; unit: string }
  rateWindows: MucUsageRateWindow[]
  topModels: MucUsageModelStat[]
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

// /v1/usage 按桶聚合的通用字段（quota_limited 与 unrestricted 共用）
function parseUsageBucket(bucket: unknown): { cost: number; requests: number } {
  const b = (bucket ?? {}) as Record<string, unknown>
  return { cost: num(b.cost), requests: num(b.requests) }
}

function parseRateWindows(raw: unknown): MucUsageRateWindow[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 3).map((w) => {
    const r = (w ?? {}) as Record<string, unknown>
    return {
      window: str(r.window),
      limit: num(r.limit),
      used: num(r.used),
      remaining: num(r.remaining),
      resetAt: typeof r.reset_at === "string" ? r.reset_at : undefined,
    }
  })
}

function parseTopModels(raw: unknown): MucUsageModelStat[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((m) => {
      const r = (m ?? {}) as Record<string, unknown>
      return { model: str(r.model), requests: num(r.requests), cost: num(r.cost) }
    })
    .filter((m) => m.model)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)
}

// 解析 /v1/usage 的两种响应形态（quota_limited / unrestricted 订阅|钱包），
// 未识别的结构归为 unknown 模式（仍尽力展示今日/累计用量）。
export function parseMucUsage(body: unknown): MucUsageSnapshot {
  const d = (body ?? {}) as Record<string, unknown>
  const usage = d.usage as Record<string, unknown> | undefined
  const today = parseUsageBucket(usage?.today)
  const total = parseUsageBucket(usage?.total)
  const mode = str(d.mode)

  const snapshot: MucUsageSnapshot = {
    planName: "",
    remaining: null,
    unit: str(d.unit) || "USD",
    mode: "unknown",
    todayCost: today.cost,
    todayRequests: today.requests,
    totalCost: total.cost,
    totalRequests: total.requests,
    rateWindows: parseRateWindows(d.rate_limits),
    topModels: parseTopModels(d.model_stats),
  }
  if (typeof d.expires_at === "string" && d.expires_at) snapshot.expiresAt = d.expires_at

  if (mode === "quota_limited") {
    snapshot.mode = "quota_limited"
    const quota = (d.quota ?? {}) as Record<string, unknown>
    snapshot.quota = {
      limit: num(quota.limit),
      used: num(quota.used),
      remaining: num(quota.remaining),
      unit: str(quota.unit) || "USD",
    }
    snapshot.remaining = quota.remaining === undefined ? null : num(quota.remaining)
    snapshot.planName = str(d.plan_name) || "配额 Key"
    return snapshot
  }

  // unrestricted：订阅分组（planName=分组名）或钱包（planName="钱包余额"）
  const remaining = d.remaining
  if (typeof remaining === "number" && Number.isFinite(remaining)) snapshot.remaining = remaining
  snapshot.planName = str(d.plan_name)
  if (str(d.plan_name) === "钱包余额" || d.balance !== undefined) {
    snapshot.mode = "wallet"
    if (snapshot.planName === "") snapshot.planName = "钱包余额"
  } else {
    snapshot.mode = "subscription"
    if (snapshot.planName === "") snapshot.planName = "订阅"
  }
  return snapshot
}

export async function fetchMucUsage(
  gateway: string,
  apiKey: string,
  clientVersion?: string,
): Promise<MucUsageSnapshot | undefined> {
  try {
    const url = gateway.replace(/\/+$/, "") + "/v1/usage"
    // MUC Harness: 附带 mucode/<版本> UA，服务端可统计旧版滞留率；版本未知时不影响请求
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    if (clientVersion) headers["User-Agent"] = `mucode/${clientVersion}`
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return undefined
    // 网关返回裸 JSON；兼容 {data:...} 包装以防未来调整
    const body = (await res.json().catch(() => null)) as any
    const payload = body?.data ?? body
    if (!payload || typeof payload !== "object") return undefined
    return parseMucUsage(payload)
  } catch {
    return undefined
  }
}
