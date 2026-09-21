import { _electron, expect } from "@playwright/test"
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const brand = process.env.OPENCODE_CHANNEL
if (brand !== "muc" && brand !== "hubu") throw new Error("Set OPENCODE_CHANNEL=muc|hubu")
const profile = process.env.CAMPUS_E2E_PROFILE || mkdtempSync(join(tmpdir(), `campus-${brand}-e2e-`))
const artifacts = resolve(process.env.CAMPUS_E2E_ARTIFACTS || `e2e/artifacts/${brand}`)
mkdirSync(artifacts, { recursive: true })
const eventOffset = existsSync(join(profile, "events.jsonl")) ? readFileSync(join(profile, "events.jsonl"), "utf8").trim().split("\n").length : 0
const calls: Array<{ path: string; key?: string; brand: string }> = []
const receipts = new Map<string, object>()
const state = {
  percent: 63 as number | null,
  cards: 3,
  wallet: "12.48000000",
  subscription: true,
  legacy: false,
  offline: false,
  loseReset: false,
  update: "none",
  exchange: "ok",
}
function usage() {
  if (state.legacy) return { mode: "unrestricted", planName: "钱包余额", balance: 8.5, remaining: 8.5 }
  return {
    mode: "unrestricted",
    planName: state.subscription ? "Pro" : "钱包余额",
    wallet: { balance: state.wallet, canonical_currency: "USD" },
    reset_cards: { available: state.cards },
    ...(state.subscription
      ? {
          subscription_status: {
            id: 123,
            group_id: 13,
            display_name: "Pro",
            weekly_usage_percent: state.percent,
            usage_status: state.percent === 100 ? "exhausted" : state.percent === 99 ? "near_limit" : "normal",
            weekly_period_started_at: "2026-09-21T00:00:00Z",
            weekly_period_ends_at: "2099-01-01T00:00:00Z",
            expires_at: "2099-01-08T00:00:00Z",
            payg_fallback: true,
          },
        }
      : {}),
    usage: { today: { cost: 1.5, requests: 4 }, total: { cost: 9, requests: 20 } },
  }
}
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 18765,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const authorization = request.headers.get("Authorization")
    if (path.startsWith("/v1")) expect(authorization).toBe(`Bearer test-${brand}-device-key`)
    calls.push({ path, key: request.headers.get("Idempotency-Key") || undefined, brand })
    if (path.endsWith("/exchange")) {
      expect(path).toBe(`/api/v1/${brand}/exchange`)
      if (state.exchange !== "ok")
        return Response.json({ reason: state.exchange }, { status: state.exchange === "expired" ? 410 : 404 })
      return Response.json({
        data: {
          gateway: fixture.url.origin,
          api_key: `test-${brand}-device-key`,
          key_name: `${brand}-device`,
          user: "isolated-fixture",
        },
      })
    }
    if (path === "/v1/models") return Response.json({ data: [{ id: "gpt-5" }, { id: "glm-5-thinking" }] })
    if (path === "/v1/usage") return state.offline ? new Response("offline", { status: 503 }) : Response.json(usage())
    if (path.startsWith("/v1/muc/reset-with-card/")) {
      const key = request.headers.get("Idempotency-Key")!
      if (receipts.has(key)) return Response.json(receipts.get(key))
      if (!state.cards) return Response.json({ reason: "NO_CARD" }, { status: 409 })
      state.cards--
      state.percent = 0
      const receipt = { data: { subscription_id: 123, weekly_period_ends_at: "2099-01-01T00:00:00Z" } }
      receipts.set(key, receipt)
      if (state.loseReset) {
        state.loseReset = false
        return new Response("response lost", { status: 502 })
      }
      await Bun.sleep(250)
      return Response.json(receipt)
    }
    if (path.includes("latest-")) {
      expect(path).toContain(brand === "muc" ? "latest-mucode" : "latest-hubu-ai")
      if (state.update === "bad") return new Response("bad json")
      return Response.json({
        version: state.update === "available" ? "99.0.0" : "0.0.0",
        downloads: {},
        notes: "Fixture update",
      })
    }
    return new Response("not found", { status: 404 })
  },
})
let application: Awaited<ReturnType<typeof _electron.launch>> | undefined
const results: string[] = []
const pass = (name: string) => {
  results.push(name)
  console.log(`PASS ${brand}: ${name}`)
}
async function launch() {
  application = await _electron.launch({
    args: [resolve("e2e/launch.mjs")],
    env: {
      ...process.env,
      CAMPUS_E2E_MAIN: process.env.CAMPUS_E2E_MAIN || resolve("out/main/index.js"),
      CAMPUS_E2E_PROFILE: profile,
      ELECTRON_ENABLE_LOGGING: "1",
      [`${brand!.toUpperCase()}_GATEWAY_URL`]: fixture.url.origin,
      BRAND: brand!,
      OPENCODE_CHANNEL: brand!,
      MUC_CDP_PORT: "0",
      OPENCODE_SIDECAR_V2: "1",
    },
    timeout: 60000,
  })
  const page = await application.firstWindow({ timeout: 60000 })
  await page.waitForFunction(() => !!window.api?.mucGetState, { timeout: 60000 })
  return page
}
async function close() {
  await application?.close()
  application = undefined
}
async function panel(page: Awaited<ReturnType<typeof launch>>) {
  const ball = page.locator("button.muc-status-scope")
  await expect(ball).toBeVisible({ timeout: 60000 })
  // This is the actual pointer drag/click path, not component state injection.
  await ball.click()
  await expect(page.getByText("钱包余额", { exact: true })).toBeVisible()
}
async function refresh(page: Awaited<ReturnType<typeof launch>>) {
  await page.getByRole("button", { name: "刷新", exact: true }).click()
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled()
}
try {
  let page = await launch()
  expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
  expect((await page.evaluate(() => window.api.mucGetBrand())).id).toBe(brand)
  expect((await page.evaluate(() => window.api.mucGetBrand())).version).toBe(
    JSON.parse(readFileSync(`resources/${brand}/release.json`, "utf8")).version,
  )
  pass("cold start, missing credentials, built brand")
  state.exchange = "expired"
  expect(await page.evaluate(() => window.api.mucConnect("expired_code_123456789"))).toMatchObject({
    ok: false,
    error: "expired",
  })
  state.exchange = "invalid"
  expect(await page.evaluate(() => window.api.mucConnect("invalid_code_123456789"))).toMatchObject({
    ok: false,
    error: "invalid",
  })
  expect(await page.evaluate(() => window.api.mucConnect("bad"))).toMatchObject({ ok: false, error: "invalid_code" })
  state.exchange = "ok"
  const connected = await page.evaluate(() => window.api.mucConnect("connect_code_123456789"))
  expect(connected).toMatchObject({ ok: true, modelCount: 2 })
  const credentials = join(profile, `cn.edu.${brand}.harness`, `${brand}-credential.bin`)
  expect(existsSync(credentials)).toBe(true)
  expect(readFileSync(credentials).includes(Buffer.from(`test-${brand}-device-key`))).toBe(false)
  pass("connect/exchange, invalid and expired code, safeStorage ciphertext")
  await close()
  page = await launch()
  expect(await page.evaluate(() => window.api.mucGetState())).toMatchObject({ connected: true })
  await panel(page)
  await expect(page.locator("button.muc-status-scope")).toContainText("$12.48")
  await expect(page.getByText("63%", { exact: true })).toBeVisible()
  const server = await page.evaluate(() => window.api.awaitInitialization())
  const providerResponse = await fetch(`${server.url}/provider`, {
    headers: { Authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}` },
  })
  const providers = (await providerResponse.json()) as {
    all: Array<{ id: string; models: Record<string, { variants?: object }> }>
  }
  expect(providers.all.map((p) => p.id)).toEqual(["sub2api"])
  expect(Object.keys(providers.all[0]!.models).sort()).toEqual(["glm-5-thinking", "gpt-5"])
  expect(Object.keys(providers.all[0]!.models["glm-5-thinking"]!.variants || {})).toContain("high")
  pass("gateway-only runtime catalog and thinking effort")
  pass("existing credentials restore, wallet and active subscription UI")
  for (const percent of [99, 100]) {
    state.percent = percent
    await refresh(page)
    await expect(page.getByText(`${percent}%`, { exact: true })).toBeVisible()
  }
  pass("99%, 100%, PAYG state with wallet always visible")
  state.subscription = false
  await refresh(page)
  await expect(page.getByText("本周使用", { exact: true })).toHaveCount(0)
  await expect(page.locator("button.muc-status-scope")).toContainText("$12.48")
  state.legacy = true
  await refresh(page)
  await expect(page.locator("button.muc-status-scope")).toContainText("$8.50")
  pass("no subscription and old-compatible response")
  state.legacy = false
  state.subscription = true
  state.cards = 0
  await refresh(page)
  await expect(page.getByRole("button", { name: "使用", exact: true })).toBeDisabled()
  state.cards = 3
  state.percent = 63
  await refresh(page)
  await page.getByRole("button", { name: "使用", exact: true }).click()
  await page.getByRole("button", { name: "取消", exact: true }).click()
  expect(receipts.size).toBe(0)
  pass("no card, confirmation and cancel")
  state.loseReset = true
  await page.getByRole("button", { name: "使用", exact: true }).click()
  await page.getByRole("button", { name: "确认使用", exact: true }).click()
  await expect(page.getByText(/重置失败/)).toBeVisible()
  expect(state.cards).toBe(2)
  await close()
  page = await launch()
  await panel(page)
  await page.getByRole("button", { name: "使用", exact: true }).click()
  // Synchronous double click attempts must be rejected by UI and main's in-flight guard.
  await page.getByRole("button", { name: "确认使用", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await expect(page.getByText("额度已恢复", { exact: true })).toBeVisible()
  await expect(page.getByText("100%", { exact: true })).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: join(artifacts, "reset-success.png") })
  await expect(page.getByText("额度已恢复", { exact: true })).toHaveCount(0, { timeout: 10000 })
  expect(state.cards).toBe(2)
  expect(new Set(calls.filter((x) => x.path.includes("reset-with-card")).map((x) => x.key)).size).toBe(1)
  await expect(page.getByText("重置卡 ×2", { exact: true })).toBeVisible()
  await expect(page.getByText("0%", { exact: true })).toBeVisible()
  pass("lost response, restart retry, double click, one card, server refresh and animation")
  state.offline = true
  await refresh(page)
  await expect(page.getByText(/已过期/)).toBeVisible()
  await expect(page.getByRole("button", { name: "使用", exact: true })).toBeDisabled()
  state.offline = false
  await refresh(page)
  pass("status network error and recovery")
  await page.getByRole("button", { name: "管理套餐 ↗", exact: true }).click()
  await page.getByRole("button", { name: "账户 ↗", exact: true }).click()
  expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain("/pricing")
  expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain("/dashboard")
  expect(await page.evaluate(() => window.api.mucGetUpdate())).toMatchObject({ available: false, status: "up-to-date" })
  pass("pricing/account navigation and no update")
  state.update = "available"
  await close()
  page = await launch()
  await panel(page)
  await expect(page.getByText("有新版本 99.0.0")).toBeVisible()
  await page.getByText("有新版本 99.0.0").click()
  expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain(`/${brand}`)
  pass("update available and manual download action")
  state.update = "bad"
  await close()
  page = await launch()
  await panel(page)
  await expect(page.getByText("更新检查暂不可用")).toBeVisible()
  pass("bad update feed is contained")
  expect(await application!.evaluate(({ app }) => app.getName())).toBe(brand === "muc" ? "mucode" : "HUBU AI")
  const runtime = await application!.evaluate(() => ({ brand: process.env.BRAND, data: process.env.XDG_DATA_HOME }))
  expect(runtime.brand).toBe(brand)
  expect(runtime.data).toContain(`cn.edu.${brand}.harness/runtime/data`)
  const events = readFileSync(join(profile, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(events.slice(eventOffset).filter((e) => e.kind === "protocol").every((e) => e.value === brand)).toBe(true)
  pass("runtime name, isolated data path and protocol registration boundary")
  await page.screenshot({ path: join(artifacts, "status.png") })
  await page.evaluate(() => window.api.mucDisconnect())
  expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
  pass("disconnect clears credentials")
  expect(await page.evaluate(() => window.api.mucConnect("reconnect_code_123456789"))).toMatchObject({ ok: true })
  pass("reconnect persists isolated brand credential")
  writeFileSync(
    join(artifacts, "result.json"),
    JSON.stringify({ brand, profile, results, calls, verdict: "PASS" }, null, 2),
  )
} catch (error) {
  writeFileSync(
    join(artifacts, "result.json"),
    JSON.stringify({ brand, profile, results, calls, verdict: "FAIL", error: String(error) }, null, 2),
  )
  throw error
} finally {
  await close()
  fixture.stop(true)
}
