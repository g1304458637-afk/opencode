import { _electron, expect } from "@playwright/test"
import { createServer } from "node:http"
import { setTimeout as sleep } from "node:timers/promises"
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const brand = process.env.OPENCODE_CHANNEL
if (brand !== "muc" && brand !== "hubu") throw new Error("Set OPENCODE_CHANNEL=muc|hubu")
const profile = process.env.CAMPUS_E2E_PROFILE || mkdtempSync(join(tmpdir(), `campus-${brand}-e2e-`))
const brandProfile = join(profile, brand === "muc" ? "cn.edu.muc.harness" : "cn.edu.hubu.harness")
mkdirSync(brandProfile, { recursive: true })
writeFileSync(join(brandProfile, "opencode.global.dat"), JSON.stringify({ language: JSON.stringify({ locale: "zh" }) }))
const artifacts = resolve(process.env.CAMPUS_E2E_ARTIFACTS || `e2e/artifacts/${brand}`)
mkdirSync(artifacts, { recursive: true })
const eventOffset = existsSync(join(profile, "events.jsonl"))
  ? readFileSync(join(profile, "events.jsonl"), "utf8").trim().split("\n").length
  : 0
const calls: Array<{ path: string; key?: string; brand: string }> = []
const receipts = new Map<string, object>()
const rewardEvents: Array<{
  id: string
  type: string
  quantity: number
  occurred_at: string
  subscription_id?: number
}> = []
const state = {
  percent: 63 as number | null,
  cards: 3,
  usageDelay: 0,
  week: 80,
  epoch: "2026-09-22T00:00:00Z",
  wallet: "12.48000000",
  subscription: true,
  legacy: false,
  offline: false,
  loseReset: false,
  failResetRefresh: false,
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
    reward_arrivals: { account_id: "123", events: rewardEvents },
    ...(state.subscription
      ? {
          subscription_status: {
            id: 123,
            group_id: 13,
            display_name: "Pro",
            quota_policy: "dual_window_v1",
            short_window: {
              remaining_percent: 100 - (state.percent ?? 0),
              starts_at: state.epoch,
              resets_at: "2099-01-01T00:00:00Z",
              exhausted: state.percent === 100,
            },
            weekly_window: {
              remaining_percent: state.week,
              starts_at: state.epoch,
              resets_at: "2099-01-03T00:00:00Z",
              exhausted: false,
            },
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
// Run the Playwright driver under Node, including when Electron is cold.
async function serveFixture(options: {
  hostname: string
  port: number
  fetch: (request: Request) => Promise<Response>
}) {
  const url = new URL(`http://${options.hostname}:${options.port}`)
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const request = new Request(new URL(incoming.url || "/", url), {
        method: incoming.method,
        headers: incoming.headers as Record<string, string>,
        ...(body.length ? { body } : {}),
      })
      const response = await options.fetch(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      outgoing.writeHead(500)
      outgoing.end(String(error))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port, options.hostname, resolve)
  })
  return {
    url,
    stop: () => {
      server.closeAllConnections()
      server.close()
    },
  }
}
const fixture = await serveFixture({
  hostname: "127.0.0.1",
  port: 18765,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const authorization = request.headers.get("Authorization")
    if (path.startsWith("/v1")) expect(authorization).toBe(`Bearer test-${brand}-device-key`)
    calls.push({ path, key: request.headers.get("Idempotency-Key") || undefined, brand })
    if (path.endsWith("/exchange")) {
      expect(path).toBe(`/api/v1/${brand}/exchange`)
      if (state.exchange === "wrong-brand")
        return Response.json({
          data: {
            gateway: fixture.url.origin,
            brand: brand === "muc" ? "hubu" : "muc",
            audience: `${brand}:desktop`,
            api_key: "foreign-fixture-key",
          },
        })
      if (state.exchange !== "ok")
        return Response.json({ reason: state.exchange }, { status: state.exchange === "expired" ? 410 : 404 })
      return Response.json({
        data: {
          gateway: fixture.url.origin,
          brand,
          audience: `${brand}:desktop`,
          api_key: `test-${brand}-device-key`,
          key_name: `${brand}-device`,
          user: "isolated-fixture",
        },
      })
    }
    if (path === "/v1/models") return Response.json({ data: [{ id: "gpt-5" }, { id: "glm-5-thinking" }] })
    if (path === "/v1/usage") {
      if (state.usageDelay) await sleep(state.usageDelay)
      return state.offline ? new Response("offline", { status: 503 }) : Response.json(usage())
    }
    if (path.endsWith("/prepare")) return Response.json({ data: { status: "pending" } })
    if (path.endsWith("/reconcile")) {
      const receipt = receipts.get(request.headers.get("Idempotency-Key")!) as
        | { data: { weekly_period_ends_at: string } }
        | undefined
      return Response.json({
        data: receipt
          ? { status: "succeeded", weekly_period_ends_at: receipt.data.weekly_period_ends_at }
          : { status: "cancelled" },
      })
    }
    if (path.startsWith("/v1/muc/reset-with-card/")) {
      expect(request.headers.get("X-Quota-Contract")).toBe("2")
      const key = request.headers.get("Idempotency-Key")!
      if (receipts.has(key)) return Response.json(receipts.get(key))
      if (!state.cards) return Response.json({ reason: "NO_CARD" }, { status: 409 })
      state.cards--
      state.percent = 10
      const receipt = { data: { subscription_id: 123, weekly_period_ends_at: "2099-01-01T00:00:00Z" } }
      receipts.set(key, receipt)
      if (state.loseReset) {
        state.loseReset = false
        return new Response("response lost", { status: 502 })
      }
      if (state.failResetRefresh) {
        state.failResetRefresh = false
        state.offline = true
      }
      await sleep(250)
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
  if (!(await page.locator(".quota-panel").isVisible())) await ball.click()
  await expect(page.locator(".quota-panel")).toBeVisible()
}
async function refresh(page: Awaited<ReturnType<typeof launch>>) {
  await panel(page)
  await page.getByRole("button", { name: "刷新", exact: true }).click()
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled()
}
try {
  let page = await launch()
  if (process.env.CAMPUS_E2E_PREVIEW_ONLY === "1") {
    // Keep the actual desktop client open against the same loopback-only fixture.
    // This profile and its credentials are synthetic; no production account is used.
    expect(await page.evaluate(() => window.api.mucConnect("local_preview_code_123456789"))).toMatchObject({ ok: true })
    await page.reload()
    await expect(page.locator(".reward-preview")).toBeVisible({ timeout: 60000 })
    application!.on("close", () => {
      fixture.stop()
      process.exit(0)
    })
    console.log(`READY ${brand}: complete local client, synthetic account, three preview actions, no recording`)
    await new Promise(() => {})
  }
  expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
  expect((await page.evaluate(() => window.api.mucGetBrand())).id).toBe(brand)
  expect((await page.evaluate(() => window.api.mucGetBrand())).version).toBe(
    JSON.parse(readFileSync(`resources/${brand}/release.json`, "utf8")).version,
  )
  pass("cold start, missing credentials, built brand")
  state.exchange = "wrong-brand"
  expect(await page.evaluate(() => window.api.mucConnect("wrong_brand_code_123456789"))).toMatchObject({
    ok: false,
    error: "bad_response",
  })
  expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
  pass("same-origin foreign brand response rejected before credential save")
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
  await expect(page.locator("button.muc-status-scope")).toContainText("37%")
  await expect(page.getByText("37%", { exact: true }).first()).toBeVisible()
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
  pass("existing credentials restore and remaining-only subscription UI")
  for (const percent of [99, 100]) {
    state.percent = percent
    await refresh(page)
    await expect(page.getByText(`${100 - percent}%`, { exact: true }).first()).toBeVisible()
  }
  await expect(page.locator(".muc-status-scope").filter({ hasText: "钱包余额" })).toHaveCount(0)
  pass("remaining 1% and 0%, no money in subscription popover")
  state.subscription = false
  await refresh(page)
  await expect(page.getByText("本周使用", { exact: true })).toHaveCount(0)
  await expect(page.locator("button.muc-status-scope")).toContainText("未订阅")
  state.legacy = true
  await refresh(page)
  await expect(page.locator("button.muc-status-scope")).toContainText("未订阅")
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
  await expect(page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')).toHaveCount(0)
  await close()
  page = await launch()
  await panel(page)
  await page.getByRole("button", { name: "使用", exact: true }).click()
  // Synchronous double click attempts must be rejected by UI and main's in-flight guard.
  await page.getByRole("button", { name: "确认使用", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await expect(page.locator(".quota-reset-feedback")).toHaveText("额度已恢复")
  await expect(page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')).toBeVisible()
  await expect(page.locator("button.muc-status-scope")).toContainText("80%", { timeout: 10000 })
  await page.screenshot({ path: join(artifacts, "reset-success.png") })
  await expect(page.locator(".quota-reset-feedback")).toHaveCount(0, { timeout: 10000 })
  await expect(page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')).toHaveCount(0, { timeout: 10000 })
  expect(state.cards).toBe(2)
  expect(new Set(calls.filter((x) => x.path.includes("reset-with-card")).map((x) => x.key)).size).toBe(1)
  await expect(page.getByText("重置卡 ×2", { exact: true })).toBeVisible()
  await expect(page.locator(".quota-windows").getByText("90%", { exact: true })).toBeVisible()
  pass("lost response, restart retry, double click, one card, server refresh and animation")
  // A successful API operation with a failed follow-up read must not celebrate or spend twice.
  state.percent = 65
  state.week = 50
  await refresh(page)
  state.failResetRefresh = true
  const callsBeforeUse = calls.filter((x) => /reset-with-card\/123$/.test(x.path)).length
  await page.getByRole("button", { name: "使用", exact: true }).click()
  await page.getByRole("button", { name: "确认使用", exact: true }).click()
  await expect(page.getByText(/重置已成功，状态刷新失败/)).toBeVisible()
  await expect(page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')).toHaveCount(0)
  expect(state.cards).toBe(1)
  state.offline = false
  await page.getByRole("button", { name: "重新核对", exact: true }).click()
  await expect(page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')).toBeVisible()
  await page.getByRole("button", { name: "跳过演出", exact: true }).click()
  await expect(page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')).toHaveCount(0)
  await expect(page.locator("button.muc-status-scope")).toContainText("50%")
  expect(state.cards).toBe(1)
  expect(calls.filter((x) => /reset-with-card\/123$/.test(x.path)).length).toBe(callsBeforeUse + 1)
  await refresh(page)
  await expect(page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')).toHaveCount(0)
  pass("confirmed use refresh failure, reconciliation without another spend, skip and no replay")

  state.offline = true
  await refresh(page)
  await expect(page.getByText(/已过期/)).toBeVisible()
  await expect(page.getByRole("button", { name: "使用", exact: true })).toBeDisabled()
  state.offline = false
  await refresh(page)
  pass("status network error and recovery")
  if (process.env.CAMPUS_E2E_VISUAL === "1") {
    const orb = page.locator(".quota-orb")
    // Electron's HTML does not have Vite's data-brand attribute. Material tokens
    // must still reach the real shell and the quota overlay in packaged builds.
    await expect(page.locator("body")).toHaveAttribute("data-campus-workspace", brand)
    expect(await orb.evaluate((element) => getComputedStyle(element).getPropertyValue("--workspace-text").trim())).toBe(
      "#f4f4f2",
    )
    state.week = 100
    await page.setViewportSize({ width: 1586, height: 992 })
    for (const [value, level] of [
      [100, "healthy"],
      [75, "normal"],
      [30, "low"],
      [10, "critical"],
    ] as const) {
      state.percent = 100 - value
      await refresh(page)
      await expect(orb).toHaveAttribute("data-level", level)
      await expect(orb).toHaveAttribute("data-charge", "idle")
      await expect(page.getByRole("progressbar", { name: "5 小时剩余" })).toHaveAttribute(
        "aria-valuenow",
        String(value),
      )
      await page.screenshot({ path: join(artifacts, `quota-${value}.png`) })
      if (value === 100) {
        await page.locator(".quota-panel").screenshot({ path: join(artifacts, "quota-panel-detail.png") })
        await orb.screenshot({ path: join(artifacts, "quota-orb-detail.png") })
      }
    }
    pass("100/75/30/10 percent visual states and no charge on ordinary refresh")
    state.percent = 0
    state.epoch = "2026-09-22T05:00:00Z"
    await refresh(page)
    await expect(orb).toHaveAttribute("data-charge", /awaken|charging/)
    await sleep(450)
    await page.screenshot({ path: join(artifacts, "quota-charge.png") })
    // The full pulse lasts only 350 ms; default exponential assertion polling can skip it.
    await page.waitForFunction(
      () => document.querySelector(".quota-orb")?.getAttribute("data-charge") === "fullPulse",
      undefined,
      { polling: "raf", timeout: 2500 },
    )
    await page.screenshot({ path: join(artifacts, "quota-full-pulse.png") })
    await expect(orb).toHaveAttribute("data-charge", "idle")
    await expect(orb).toContainText("100%")
    await refresh(page)
    await expect(orb).toHaveAttribute("data-charge", "idle")
    pass("server rollover charges once, reaches full pulse and settles")
    await page.emulateMedia({ reducedMotion: "reduce" })
    state.percent = 90
    await refresh(page)
    state.percent = 0
    state.epoch = "2026-09-22T10:00:00Z"
    await refresh(page)
    await expect(orb).toHaveAttribute("data-charge", "idle")
    expect(
      await page
        .locator(".muc-status-scope")
        .evaluateAll((elements) => elements.flatMap((element) => element.getAnimations({ subtree: true })).length),
    ).toBe(0)
    await page.screenshot({ path: join(artifacts, "quota-reduced-motion.png") })
    await page.emulateMedia({ reducedMotion: "no-preference" })
    pass("reduced motion disables idle and charge animations")
    for (const viewport of [
      { width: 768, height: 640 },
      { width: 420, height: 600 },
      { width: 1000, height: 420 },
    ]) {
      await page.setViewportSize(viewport)
      const bounds = await page.locator(".quota-panel").boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: join(artifacts, `quota-${viewport.width}x${viewport.height}.png`) })
    }
    await page.setViewportSize({ width: 1200, height: 800 })
    const ball = page.locator(".quota-orb-button")
    const box = await ball.boundingBox()
    await page.mouse.move(box!.x + 40, box!.y + 40)
    await page.mouse.down()
    await page.mouse.move(80, 60, { steps: 8 })
    await page.mouse.up()
    await expect(ball).toHaveAttribute("aria-expanded", "true")
    const below = await page.locator(".quota-panel").boundingBox()
    expect(below!.y).toBeGreaterThan(100)
    await page.screenshot({ path: join(artifacts, "quota-top-edge.png") })
    await ball.press("Escape")
    await expect(page.locator(".quota-panel")).toHaveCount(0)
    await ball.press("Enter")
    await expect(page.locator(".quota-panel")).toBeVisible()
    await expect(orb).toHaveAttribute("data-charge", "idle")
    pass("responsive bounds, drag without toggle, keyboard open/close and no replay")
    // Sample Electron's own OS process metrics after an idle period (no RAF sampling loop).
    await application!.evaluate(({ app }) => app.getAppMetrics())
    await sleep(5000)
    const metrics = await application!.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, cpu, memory }) => ({ type, cpu, memory })),
    )
    writeFileSync(join(artifacts, "idle-metrics.json"), JSON.stringify(metrics, null, 2))
    pass("idle process metrics captured")
    state.week = 80
  }

  if (process.env.CAMPUS_E2E_REWARD === "1") {
    await page.setViewportSize({ width: 1440, height: 900 })
    const newSession = page.locator('[data-action="home-new-session"]')
    if (await newSession.isVisible()) await newSession.click()
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible()
    await panel(page)
    const notice = page.locator(".reward-arrival")
    const captureReward = async (name: string) => {
      // Capture immediately: Playwright screenshot font readiness can outlive a finite scene/toast.
      const session = await page.context().newCDPSession(page)
      const shot = await session.send("Page.captureScreenshot", { format: "png" })
      writeFileSync(join(artifacts, name), Buffer.from(shot.data, "base64"))
      await session.detach()
    }
    const motion = page.locator(".reward-motion-layer")
    const orb = page.locator(".quota-orb")
    let sequence = 0
    const arrival = (card: boolean, quantity = 1) => {
      rewardEvents.push({
        id: `${card ? "card" : "reset"}:e2e-${++sequence}`,
        type: card ? "reset_card_received" : "global_reset_received",
        quantity,
        occurred_at: new Date().toISOString(),
        ...(card ? {} : { subscription_id: 123 }),
      })
      if (card) state.cards += quantity
    }
    const dismiss = async () => {
      if (await notice.isVisible()) await page.getByRole("button", { name: "关闭奖励到账通知" }).click()
    }
    state.percent = 80
    state.week = 41
    await refresh(page)
    arrival(false)
    state.percent = 0
    state.week = 100
    await refresh(page)
    await expect(motion).toHaveAttribute("data-kind", "FULL_RESET")
    await expect(notice).toHaveCount(0)
    await sleep(2500)
    const heroGeometry = await page.locator(".reward-hero").evaluate((el) => {
      const hero = el.getBoundingClientRect()
      return { width: hero.width, font: parseFloat(getComputedStyle(el.querySelector(".reward-hero-value")!).fontSize) }
    })
    expect(heroGeometry.width).toBeGreaterThan(300)
    expect(heroGeometry.font).toBeGreaterThanOrEqual(100)
    await captureReward("motion-full-reset.png")
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await expect(notice).toContainText("全额重置完成")
    await expect(orb).toContainText("100%")
    await expect(page.getByRole("progressbar", { name: "5 小时剩余" })).toHaveAttribute("aria-valuenow", "100")
    await dismiss()
    await refresh(page)
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await expect(notice).toHaveCount(0)
    pass("full reset plays before toast, reaches authoritative windows, no replay")
    arrival(true)
    await refresh(page)
    await expect(motion).toHaveAttribute("data-kind", "RESET_CARD_GRANTED")
    const destination = await page.locator(".quota-reset-count").boundingBox()
    const flight = await motion.evaluate((el) => ({
      x: Number.parseFloat((el as HTMLElement).style.getPropertyValue("--target-x")),
      y: Number.parseFloat((el as HTMLElement).style.getPropertyValue("--target-y")),
    }))
    expect(Math.abs(flight.x - (destination!.x + destination!.width / 2))).toBeLessThan(1)
    expect(Math.abs(flight.y - (destination!.y + destination!.height / 2))).toBeLessThan(1)
    await sleep(1100)
    await captureReward("motion-card-reveal.png")
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await expect(notice).toContainText("获得重置卡 ×1")
    await expect(page.locator(".quota-reset-count")).toContainText(String(state.cards))
    await dismiss()
    pass("artifact reveal targets real inventory DOMRect and count settles")
    arrival(true)
    arrival(true)
    arrival(true)
    arrival(false)
    await refresh(page)
    await expect(motion).toHaveAttribute("data-kind", "FULL_RESET")
    await expect(motion).toHaveAttribute("data-kind", "RESET_CARD_GRANTED", { timeout: 8000 })
    await expect(page.locator(".reward-artifact-quantity")).toHaveText("×3")
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await expect(notice).toContainText("获得重置卡 ×3")
    await dismiss()
    pass("simultaneous reset wins priority and three cards aggregate")
    await page.emulateMedia({ reducedMotion: "reduce" })
    arrival(true)
    await refresh(page)
    await expect(motion).toHaveAttribute("data-reduced", "true")
    await expect(page.locator(".reward-motes")).toHaveCount(0)
    await sleep(1100)
    await captureReward("motion-reduced.png")
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await dismiss()
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.reload()
    await expect(orb).toBeVisible()
    await expect(notice).toHaveCount(0)
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await panel(page)
    pass("reduced motion and persisted dedupe after renderer reload")
    const editor = page.locator('[contenteditable="true"]').first()
    await expect(editor).toBeVisible()
    state.usageDelay = 500
    arrival(true)
    await page.getByRole("button", { name: "刷新", exact: true }).click()
    await page.locator(".quota-orb-button").press("Escape")
    await editor.fill("Reward focus retention test")
    await expect(motion).toHaveAttribute("data-kind", "RESET_CARD_GRANTED")
    const closedTarget = await page.locator(".quota-orb-button").boundingBox()
    const closedFlight = await motion.evaluate((el) =>
      Number.parseFloat((el as HTMLElement).style.getPropertyValue("--target-y")),
    )
    expect(Math.abs(closedFlight - (closedTarget!.y + closedTarget!.height / 2))).toBeLessThan(1)
    await expect(editor).toBeFocused()
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await expect(editor).toHaveText("Reward focus retention test")
    await expect(editor).toBeFocused()
    state.usageDelay = 0
    await dismiss()
    await panel(page)
    arrival(false)
    await refresh(page)
    await expect(motion).toHaveAttribute("data-kind", "FULL_RESET")
    expect(
      await page.locator(".reward-composer-ack").evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(100)
    const nativeWindow = await application!.browserWindow(page)
    await nativeWindow.evaluate((window) => window.minimize())
    await sleep(300)
    await nativeWindow.evaluate((window) => window.restore())
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await refresh(page)
    await expect(motion).toHaveCount(0, { timeout: 8000 })
    await dismiss()
    pass("actual composer draft/focus, closed-panel destination, composer geometry and background return")
  }

  await page.getByRole("button", { name: "管理套餐 ↗", exact: true }).click()
  await page.getByRole("button", { name: "账户 ↗", exact: true }).click()
  expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain("/pricing")
  expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain("/dashboard")
  if (process.env.CAMPUS_E2E_SCOPE !== "quota") {
    expect(await page.evaluate(() => window.api.mucGetUpdate())).toMatchObject({
      available: false,
      status: "up-to-date",
    })
    pass("pricing/account navigation and no update")
    state.update = "available"
    await close()
    page = await launch()
    await panel(page)
    await expect(page.getByText("有新版本 99.0.0")).toBeVisible()
    await page.getByText("有新版本 99.0.0").click()
    expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain(
      process.env.CAMPUS_E2E_DOWNLOAD_PAGE || `/${brand}`,
    )
    pass("update available and manual download action")
    state.update = "bad"
    await close()
    page = await launch()
    await panel(page)
    await expect(page.getByText("更新检查暂不可用")).toBeVisible()
    pass("bad update feed is contained")
  }
  expect(await application!.evaluate(({ app }) => app.getName())).toBe(brand === "muc" ? "mucode" : "HUBU AI")
  const runtime = await application!.evaluate(() => ({ brand: process.env.BRAND, data: process.env.XDG_DATA_HOME }))
  expect(runtime.brand).toBe(brand)
  expect(runtime.data).toContain(`cn.edu.${brand}.harness/runtime/data`)
  const events = readFileSync(join(profile, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(
    events
      .slice(eventOffset)
      .filter((e) => e.kind === "protocol")
      .every((e) => e.value === brand),
  ).toBe(true)
  pass("runtime name, isolated data path and protocol registration boundary")
  await page.screenshot({ path: join(artifacts, "status.png") })
  await page.evaluate(() => window.api.mucDisconnect())
  expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
  pass("disconnect clears credentials")
  expect(await page.evaluate(() => window.api.mucConnect("reconnect_code_123456789"))).toMatchObject({ ok: true })
  pass("reconnect persists isolated brand credential")
  writeFileSync(
    join(artifacts, "result.json"),
    JSON.stringify(
      { brand, scope: process.env.CAMPUS_E2E_SCOPE || "all", profile, results, calls, verdict: "PASS" },
      null,
      2,
    ),
  )
} catch (error) {
  writeFileSync(
    join(artifacts, "result.json"),
    JSON.stringify(
      {
        brand,
        scope: process.env.CAMPUS_E2E_SCOPE || "all",
        profile,
        results,
        calls,
        verdict: "FAIL",
        error: String(error),
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await close()
  fixture.stop()
}
