// MUC Harness: mucode 新版本自检（纯逻辑，不依赖 electron，可被 bun 直接测试）。
// 版本源固定为官方网关的 /downloads/latest-mucode.json（不用用户配置的 gateway，
// 防第三方网关劫持下载源）。只做"提示"，不自动下载安装——muc 通道关闭
// electron-updater 的初始动机（自有分发 + ad-hoc 签名）保持不变。

import { resolveBrand } from "@opencode-ai/brand"
export const MUC_OFFICIAL_GATEWAY = new URL(resolveBrand().updates.downloadPage || "https://opencode.ai").origin
export const MUC_MANIFEST_URL = resolveBrand().updates.manifest
export const MUC_DOWNLOAD_PAGE = resolveBrand().updates.downloadPage
export const MUC_UPDATE_CHECK_TIMEOUT_MS = 6_000
// 渲染层轮询/启动检查共用同一缓存，避免频繁拉取
export const MUC_UPDATE_CHECK_TTL_MS = 30 * 60 * 1000

export type MucUpdateDownload = {
  file: string
  url: string
  sha256?: string
}

export type MucUpdateManifest = {
  version: string
  releasedAt: string
  notes?: string
  minSupported?: string
  downloads: Record<string, MucUpdateDownload>
}

export type MucUpdateCheckStatus = "update-available" | "forced" | "up-to-date" | "unavailable"

export type MucUpdateCheckResult = {
  status: MucUpdateCheckStatus
  localVersion: string
  manifest?: MucUpdateManifest
}

const VERSION_LIKE = /^v?\d+\.\d+\.\d+/

export function parseMucUpdateManifest(body: unknown): MucUpdateManifest | null {
  if (!body || typeof body !== "object") return null
  const raw = body as Record<string, unknown>
  if (typeof raw.version !== "string" || !VERSION_LIKE.test(raw.version)) return null

  const manifest: MucUpdateManifest = {
    version: raw.version,
    releasedAt: typeof raw.releasedAt === "string" ? raw.releasedAt : "",
    downloads: {},
  }
  if (typeof raw.notes === "string" && raw.notes) manifest.notes = raw.notes
  if (typeof raw.minSupported === "string" && raw.minSupported) manifest.minSupported = raw.minSupported

  if (raw.downloads && typeof raw.downloads === "object") {
    for (const [key, value] of Object.entries(raw.downloads as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue
      const d = value as Record<string, unknown>
      if (typeof d.file !== "string" || typeof d.url !== "string") continue
      const entry: MucUpdateDownload = { file: d.file, url: d.url }
      if (typeof d.sha256 === "string" && d.sha256) entry.sha256 = d.sha256
      manifest.downloads[key] = entry
    }
  }
  return manifest
}

// ---- 版本比较：x.y.z[-muc.n]（语义化预发布规则：muc 序号 < 同版本无序号；
// 序号按数字比较，muc.9 < muc.10）----

type ParsedVersion = { major: number; minor: number; patch: number; muc: number | null }

export function parseMucVersion(input: string): ParsedVersion | null {
  const raw = input.trim().replace(/^v/, "")
  if (!/^\d+\.\d+\.\d+(?:-(?:muc|hubu)\.\d+)?$/.test(raw)) return null
  const [core, prerelease] = raw.split("-", 2)
  const parts = (core ?? "").split(".")
  if (parts.length !== 3) return null
  const nums = parts.map(p => Number.parseInt(p, 10))
  if (nums.some(n => !Number.isFinite(n) || n < 0)) return null

  let muc: number | null = null
  if (prerelease !== undefined) {
    const m = /^(?:muc|hubu)\.(\d+)$/.exec(prerelease)
    if (!m) return null
    muc = Number.parseInt(m[1]!, 10)
  }
  return { major: nums[0]!, minor: nums[1]!, patch: nums[2]!, muc }
}

/** >0 表示 a 更新；<0 表示 b 更新；0 相等。无法解析的版本按不可比较处理（返回 null）。 */
export function compareMucVersions(a: string, b: string): number | null {
  const pa = parseMucVersion(a)
  const pb = parseMucVersion(b)
  if (!pa || !pb) return null
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key]! - pb[key]!
  }
  // 核心版本相同：无序号的正式版 > muc 预发布；两个预发布比序号
  if (pa.muc === null && pb.muc === null) return 0
  if (pa.muc === null) return 1
  if (pb.muc === null) return -1
  return pa.muc - pb.muc
}

export function isMucUpdateAvailable(local: string, remote: string): boolean {
  const cmp = compareMucVersions(local, remote)
  return cmp !== null && cmp < 0
}

export function isMucBelowMinimum(local: string, minSupported?: string): boolean {
  if (!minSupported) return false
  const cmp = compareMucVersions(local, minSupported)
  return cmp !== null && cmp < 0
}

/** 纯决策：本地版本 + manifest（拉取失败传 null）→ 更新状态 */
export function evaluateMucUpdate(localVersion: string, manifest: MucUpdateManifest | null): MucUpdateCheckResult {
  if (!manifest) return { status: "unavailable", localVersion }
  if (isMucBelowMinimum(localVersion, manifest.minSupported)) {
    return { status: "forced", localVersion, manifest }
  }
  if (isMucUpdateAvailable(localVersion, manifest.version)) {
    return { status: "update-available", localVersion, manifest }
  }
  return { status: "up-to-date", localVersion, manifest }
}

export async function fetchMucUpdateManifest(
  fetchImpl: typeof fetch = fetch,
  url: string = MUC_MANIFEST_URL,
): Promise<MucUpdateManifest | null> {
  try {
    const res = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(MUC_UPDATE_CHECK_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return parseMucUpdateManifest(await res.json())
  } catch {
    return null
  }
}

export async function checkMucUpdate(
  localVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MucUpdateCheckResult> {
  return evaluateMucUpdate(localVersion, await fetchMucUpdateManifest(fetchImpl))
}
