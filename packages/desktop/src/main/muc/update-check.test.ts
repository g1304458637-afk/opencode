// MUC Harness: update-check 纯逻辑单测（bun test，从 packages/desktop 运行）。
import { describe, expect, test } from "bun:test"

import {
  compareMucVersions,
  evaluateMucUpdate,
  fetchMucUpdateManifest,
  isMucBelowMinimum,
  isMucUpdateAvailable,
  parseMucUpdateManifest,
  parseMucVersion,
  type MucUpdateManifest,
} from "./update-check"

const manifest = (overrides: Partial<MucUpdateManifest> = {}): MucUpdateManifest => ({
  version: "1.18.31-muc.2",
  releasedAt: "2026-09-20T00:00:00.000Z",
  downloads: {},
  ...overrides,
})

describe("parseMucVersion / compareMucVersions", () => {
  test("解析 muc 序号与正式版", () => {
    expect(parseMucVersion("1.18.31-muc.5")).toEqual({ major: 1, minor: 18, patch: 31, muc: 5 })
    expect(parseMucVersion("v1.18.31")).toEqual({ major: 1, minor: 18, patch: 31, muc: null })
    expect(parseMucVersion("1.18")).toBeNull()
    expect(parseMucVersion("1.18.31-beta.1")).toBeNull()
  })

  test("muc 序号数字比较（muc.9 < muc.10）", () => {
    expect(compareMucVersions("1.18.31-muc.9", "1.18.31-muc.10")).toBeLessThan(0)
    expect(compareMucVersions("1.18.31-muc.2", "1.18.31-muc.1")).toBeGreaterThan(0)
    expect(compareMucVersions("1.18.31-muc.3", "1.18.31-muc.3")).toBe(0)
  })

  test("上游版本升级主导（1.18.40-muc.1 > 1.18.31-muc.9）", () => {
    expect(compareMucVersions("1.18.40-muc.1", "1.18.31-muc.9")).toBeGreaterThan(0)
  })

  test("正式版 > 同版本预发布；不可解析返回 null", () => {
    expect(compareMucVersions("1.18.31", "1.18.31-muc.99")).toBeGreaterThan(0)
    expect(compareMucVersions("1.18.31-muc.1", "oops")).toBeNull()
  })

  test("isMucUpdateAvailable", () => {
    expect(isMucUpdateAvailable("1.18.31-muc.1", "1.18.31-muc.2")).toBe(true)
    expect(isMucUpdateAvailable("1.18.31-muc.2", "1.18.31-muc.2")).toBe(false)
    expect(isMucUpdateAvailable("1.18.31-muc.3", "1.18.31-muc.2")).toBe(false)
    expect(isMucUpdateAvailable("bad", "1.18.31-muc.2")).toBe(false)
  })

  test("isMucBelowMinimum：低于最低支持版本才强制", () => {
    expect(isMucBelowMinimum("1.18.31-muc.1", "1.18.31-muc.2")).toBe(true)
    expect(isMucBelowMinimum("1.18.31-muc.2", "1.18.31-muc.2")).toBe(false)
    // 未声明 minSupported 时永不强制
    expect(isMucBelowMinimum("0.9.0-muc.1", undefined)).toBe(false)
    expect(isMucBelowMinimum("bad", "1.18.31-muc.2")).toBe(false)
  })
})

describe("parseMucUpdateManifest", () => {
  test("解析完整 manifest 并跳过非法下载项", () => {
    const m = parseMucUpdateManifest({
      version: "1.18.31-muc.2",
      releasedAt: "2026-09-20",
      notes: "修复深链",
      minSupported: "1.18.31-muc.1",
      downloads: {
        "mac-arm64": { file: "mucode-mac-arm64.dmg", url: "https://x/a.dmg", sha256: "aa" },
        bad: { file: "only-file" },
      },
    })
    expect(m?.version).toBe("1.18.31-muc.2")
    expect(m?.minSupported).toBe("1.18.31-muc.1")
    expect(m?.downloads["mac-arm64"]?.sha256).toBe("aa")
    expect(Object.keys(m?.downloads ?? {})).toEqual(["mac-arm64"])
  })

  test("拒绝非法结构", () => {
    expect(parseMucUpdateManifest(null)).toBeNull()
    expect(parseMucUpdateManifest({ version: "latest" })).toBeNull()
  })
})

describe("evaluateMucUpdate", () => {
  test("manifest 拉取失败 → unavailable（不提示、不强制）", () => {
    expect(evaluateMucUpdate("1.18.31-muc.1", null).status).toBe("unavailable")
  })

  test("有新版且未低于最低支持 → update-available", () => {
    const r = evaluateMucUpdate("1.18.31-muc.1", manifest())
    expect(r.status).toBe("update-available")
    expect(r.manifest?.version).toBe("1.18.31-muc.2")
  })

  test("低于 minSupported → forced（优先于 update-available）", () => {
    expect(
      evaluateMucUpdate("1.18.30-muc.1", manifest({ minSupported: "1.18.31-muc.1" })).status,
    ).toBe("forced")
  })

  test("已是最新 → up-to-date", () => {
    expect(evaluateMucUpdate("1.18.31-muc.2", manifest()).status).toBe("up-to-date")
  })
})

describe("fetchMucUpdateManifest", () => {
  test("正常解析 + 非 2xx/网络错误返回 null", async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ version: "1.18.31-muc.2" }), { status: 200 })) as unknown as typeof fetch
    expect((await fetchMucUpdateManifest(ok))?.version).toBe("1.18.31-muc.2")

    const notOk = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch
    expect(await fetchMucUpdateManifest(notOk)).toBeNull()

    const throws = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    expect(await fetchMucUpdateManifest(throws)).toBeNull()
  })
})
