// Real Phase 3 backend; no paid model request, no production endpoint.
import { _electron, expect } from "@playwright/test"
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
const base = "http://127.0.0.1:18093"
const fixture = JSON.parse(readFileSync("/private/tmp/campus-phase4-backend-data/fixture.json", "utf8"))
const artifacts = process.env.CAMPUS_E2E_ARTIFACTS || resolve("e2e/artifacts/backend")
mkdirSync(artifacts, { recursive: true })
const mint = await fetch(`${base}/api/v1/muc/connect-code`, {
  method: "POST",
  headers: { Authorization: `Bearer ${fixture.token}`, "Content-Type": "application/json" },
  body: "{}",
}).then((r) => r.json())
if (!mint.data?.code) throw new Error("Could not mint isolated connect code")
const profile = mkdtempSync(join(tmpdir(), "campus-real-backend-"))
const application = await _electron.launch({
  args: [resolve("e2e/launch.mjs")],
  env: {
    ...process.env,
    BRAND: "muc",
    OPENCODE_CHANNEL: "muc",
    MUC_GATEWAY_URL: base,
    MUC_CDP_PORT: "0",
    CAMPUS_E2E_PROFILE: profile,
    CAMPUS_E2E_MAIN: process.env.CAMPUS_E2E_MAIN || resolve("out/main/index.js"),
  },
  timeout: 60000,
})
try {
  let page = await application.firstWindow()
  await page.waitForFunction(() => !!window.api?.mucConnect)
  expect(await page.evaluate((code) => window.api.mucConnect(code), mint.data.code)).toMatchObject({ ok: true })
  const before = await page.evaluate(() => window.api.mucGetUsage())
  expect(before).toMatchObject({
    ok: true,
    usage: {
      wallet: { balance: "12.48000000" },
      subscriptionStatus: { weeklyUsagePercent: 63 },
      resetCardsAvailable: 3,
    },
  })
  const results = await page.evaluate(
    (id) => Promise.all(Array.from({ length: 12 }, () => window.api.mucResetCard(id))),
    fixture.subscription_id,
  )
  expect(results.every((r) => r.ok)).toBe(true)
  expect(new Set(results.filter((r) => r.ok).map((r) => r.operationId)).size).toBe(1)
  const after = await page.evaluate(() => window.api.mucGetUsage())
  expect(after).toMatchObject({
    ok: true,
    usage: {
      wallet: { balance: "12.48000000" },
      subscriptionStatus: { weeklyUsagePercent: 0 },
      resetCardsAvailable: 2,
    },
  })
  const replay = await page.evaluate((id) => window.api.mucResetCard(id), fixture.subscription_id)
  expect(replay).toEqual(results[0])
  await page.evaluate(() => window.api.mucOpenPricing())
  expect(readFileSync(join(profile, "events.jsonl"), "utf8")).toContain("/pricing")
  writeFileSync(
    join(artifacts, "result.json"),
    JSON.stringify(
      {
        verdict: "PASS",
        backend: "4de8dfccf896b751824c4846821bc081612fc865",
        before,
        after,
        concurrentRequests: 12,
        distinctOperations: 1,
        walletUnchanged: true,
        tests: [
          "website connect-code",
          "Electron exchange",
          "credential persistence",
          "real usage DTO",
          "subscription",
          "wallet",
          "reset card",
          "concurrent idempotency",
          "success refresh",
          "pricing navigation",
        ],
      },
      null,
      2,
    ),
  )
  console.log(
    "PASS: real Phase 3 backend, Electron connect/usage/subscription/wallet/reset/pricing; 12 concurrent IPCs spend 1 card",
  )
} finally {
  await application.close()
}
