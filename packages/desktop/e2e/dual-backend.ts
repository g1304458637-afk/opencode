// Real isolated MUC and HUBU backends; no provider/payment calls or OS association changes.
import { _electron, expect } from "@playwright/test"
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const root = process.env.CAMPUS_DUAL_FIXTURES || "/private/tmp/campus-phase5"
const artifacts = process.env.CAMPUS_E2E_ARTIFACTS || resolve("e2e/artifacts/dual-backend")
const profile = mkdtempSync(join(tmpdir(), "campus-dual-backend-"))
mkdirSync(artifacts, { recursive: true })
const results: object[] = []
const operations = new Map<string, unknown>()
const states = new Map<string, unknown>()
async function mint(brand: string) {
  const fixture = JSON.parse(readFileSync(join(root, brand, "fixture.json"), "utf8"))
  const response = await fetch(`${fixture.base}/api/v1/${brand}/connect-code`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fixture.token}`, "Content-Type": "application/json" },
    body: "{}",
  })
  expect(response.status).toBe(200)
  const data = (await response.json()).data
  expect(data).toMatchObject({ brand, audience: `${brand}:desktop`, scheme: brand })
  if (typeof data.code !== "string" || !data.code) throw new Error("Missing campus connect code")
  return data.code
}
for (const brand of ["muc", "hubu", "muc", "hubu"]) {
  const fixture = JSON.parse(readFileSync(join(root, brand, "fixture.json"), "utf8"))
  const other = brand === "muc" ? "hubu" : "muc"
  const foreign = JSON.parse(readFileSync(join(root, other, "fixture.json"), "utf8"))
  const restarting = states.has(brand)
  const application = await _electron.launch({
    args: [resolve("e2e/launch.mjs")],
    env: {
      ...process.env,
      BRAND: brand,
      OPENCODE_CHANNEL: brand,
      [`${brand.toUpperCase()}_GATEWAY_URL`]: fixture.base,
      MUC_CDP_PORT: "0",
      CAMPUS_E2E_PROFILE: profile,
      CAMPUS_E2E_MAIN: resolve(`dist/phase5-real-${brand}/out/main/index.js`),
    },
    timeout: 60000,
  })
  console.log(`START ${brand} restart=${restarting}`)
  try {
    const page = await application.firstWindow({ timeout: 60000 })
    await page.waitForFunction(() => !!window.api?.mucGetState)
    expect(await page.evaluate(() => window.api.mucGetBrand())).toMatchObject({ id: brand, protocol: brand })
    if (!restarting) {
      expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
      expect(await page.evaluate(() => window.api.mucGetUsage())).toMatchObject({ ok: false, error: "not_connected" })
      const foreignCode = await mint(other)
      // Foreign scheme must never be consumed by this brand's main/renderer.
      await application.evaluate(
        ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
        `${other}://connect?code=${foreignCode}`,
      )
      await page.waitForTimeout(400)
      expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
      // Deliberately configure the wrong backend: its route identity must reject this desktop.
      await application.evaluate(
        (_, setting) => {
          process.env[setting.key] = setting.value
        },
        { key: `${brand.toUpperCase()}_GATEWAY_URL`, value: foreign.base },
      )
      expect(await page.evaluate((code) => window.api.mucConnect(code), foreignCode)).toMatchObject({ ok: false })
      expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
      await application.evaluate(
        (_, setting) => {
          process.env[setting.key] = setting.value
        },
        { key: `${brand.toUpperCase()}_GATEWAY_URL`, value: fixture.base },
      )
      // Same wrong code in the own endpoint also fails without saving a credential.
      expect(await page.evaluate((code) => window.api.mucConnect(code), foreignCode)).toMatchObject({ ok: false })
      const code = await mint(brand)
      await application.evaluate(
        ({ app }, url) => app.emit("open-url", { preventDefault() {} }, url),
        `${brand}://connect?code=${code}`,
      )
      await expect
        .poll(() => page.evaluate(() => window.api.mucGetState()), { timeout: 20000 })
        .toMatchObject({ connected: true, gateway: fixture.base })
      const state = await page.evaluate(() => window.api.mucGetState())
      states.set(brand, state)
      const before = await page.evaluate(() => window.api.mucGetUsage())
      expect(before).toMatchObject({
        ok: true,
        usage: {
          wallet: { balance: "12.48000000" },
          subscriptionStatus: { weeklyUsagePercent: 63, paygFallback: true },
          resetCardsAvailable: 3,
        },
      })
      const reset = await page.evaluate(
        (id) => Promise.all(Array.from({ length: 12 }, () => window.api.mucResetCard(id))),
        fixture.subscription_id,
      )
      expect(reset.every((value) => value.ok)).toBe(true)
      expect(new Set(reset.filter((value) => value.ok).map((value) => value.operationId)).size).toBe(1)
      operations.set(brand, reset[0])
      expect(await page.evaluate((id) => window.api.mucResetCard(id), fixture.subscription_id)).toEqual(reset[0])
      const after = await page.evaluate(() => window.api.mucGetUsage())
      expect(after).toMatchObject({
        ok: true,
        usage: {
          wallet: { balance: "12.48000000" },
          subscriptionStatus: { weeklyUsagePercent: 0 },
          resetCardsAvailable: 2,
        },
      })
      await page.evaluate(() => window.api.mucOpenPricing())
      expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain(`${fixture.base}/pricing`)
      const update = await page.evaluate(() => window.api.mucGetUpdate())
      expect(update).toMatchObject({ available: false, status: "up-to-date" })
      results.push({
        brand,
        before,
        after,
        wrongGatewayRejected: true,
        foreignCodeRejected: true,
        deepLink: "PASS",
        concurrentRequests: 12,
        distinctOperations: 1,
        pricing: "PASS",
        update,
      })
      await page.screenshot({ path: join(artifacts, `${brand}.png`) })
    } else {
      expect(await page.evaluate(() => window.api.mucGetState())).toEqual(states.get(brand))
      expect(await page.evaluate((id) => window.api.mucResetCard(id), fixture.subscription_id)).toEqual(
        operations.get(brand),
      )
      expect(await page.evaluate(() => window.api.mucGetUsage())).toMatchObject({
        ok: true,
        usage: { wallet: { balance: "12.48000000" }, resetCardsAvailable: 2 },
      })
      const ownFile = join(profile, `cn.edu.${brand}.harness`, `${brand}-credential.bin`)
      const otherFile = join(profile, `cn.edu.${other}.harness`, `${other}-credential.bin`)
      const ownBytes = readFileSync(ownFile)
      try {
        writeFileSync(ownFile, readFileSync(otherFile))
        expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
        expect(await page.evaluate(() => window.api.mucGetUsage())).toMatchObject({ ok: false, error: "not_connected" })
      } finally {
        writeFileSync(ownFile, ownBytes)
      }
      expect(await page.evaluate(() => window.api.mucGetState())).toEqual(states.get(brand))
      results.push({
        brand,
        restart: "PASS",
        resetReplayWithoutSecondCard: "PASS",
        foreignCipherRejected: "PASS",
        originalCredentialRetained: "PASS",
      })
    }
    console.log(
      `PASS ${brand}: ${restarting ? "restart, cross credential, reset replay" : "real backend, protocol, connect, status, wallet, PAYG, reset, pricing, update"}`,
    )
  } finally {
    console.log(`CLOSE ${brand} restart=${restarting}`)
    await Promise.race([
      application.close(),
      Bun.sleep(30000).then(() => {
        throw new Error(`Electron close timeout: ${brand}`)
      }),
    ])
  }
}
expect(readFileSync(join(profile, "cn.edu.muc.harness", "muc-device-id"), "utf8")).not.toBe(
  readFileSync(join(profile, "cn.edu.hubu.harness", "hubu-device-id"), "utf8"),
)
writeFileSync(
  join(artifacts, "result.json"),
  JSON.stringify({ verdict: "PASS", profile, numericUserID: 2, results }, null, 2),
)
