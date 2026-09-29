import { chromium, expect } from "@playwright/test"
import { writeFileSync } from "node:fs"
const browser = await chromium.launch({ headless: true })
const results = []
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors = []
page.on("pageerror", (e) => errors.push(e.message))
try {
  await page.goto("http://127.0.0.1:4198")
  await expect(page.locator(".quota-orb-number")).toHaveText("20%")
  await page.locator('[data-reward-anchor="orb"]').click()
  for (const n of [20, 95, 100]) {
    await page.getByLabel("old short", { exact: true }).fill(String(n))
    await page.getByLabel("old week", { exact: true }).fill("41")
    await page.getByRole("button", { name: "设置旧状态", exact: true }).click()
    await expect(page.locator(".quota-orb-number")).toHaveText(`${Math.min(n, 41)}%`)
    await page.getByRole("button", { name: "FULL RESET", exact: true }).click()
    await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
    await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
    await expect(page.getByRole("progressbar", { name: "5 小时剩余" })).toHaveAttribute("aria-valuenow", "100")
    results.push({ test: `full reset ${n} to 100`, result: "PASS" })
  }
  await page.getByLabel("new short", { exact: true }).fill("83")
  await page.getByLabel("new week", { exact: true }).fill("41")
  await page.getByLabel("old short", { exact: true }).fill("20")
  await page.getByRole("button", { name: "设置旧状态", exact: true }).click()
  await page.getByRole("button", { name: "FULL RESET", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  await expect(page.getByRole("progressbar", { name: "5 小时剩余" })).toHaveAttribute("aria-valuenow", "83")
  await expect(page.getByRole("progressbar", { name: "本周剩余" })).toHaveAttribute("aria-valuenow", "41")
  results.push({ test: "partial reset 20→83, weekly unchanged 41", result: "PASS" })
  for (const n of [0, 1, 5]) {
    await page.getByLabel("old cards", { exact: true }).fill(String(n))
    await page.getByLabel("new cards", { exact: true }).fill(String(n + 1))
    await page.getByRole("button", { name: "设置旧状态", exact: true }).click()
    await expect(page.locator(".quota-reset-count")).toContainText(`×${n}`)
    await page.getByRole("button", { name: "RESET CARD", exact: true }).click()
    await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
    await page.getByRole("button", { name: "DUPLICATE", exact: true }).click()
    await page.getByRole("button", { name: "DUPLICATE", exact: true }).click()
    await expect(page.locator(".reward-artifact-quantity")).toHaveText("×1")
    await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
    await expect(page.locator(".quota-reset-count")).toContainText(`×${n + 1}`)
    results.push({ test: `card ${n}→${n + 1}, rapid duplicate`, result: "PASS" })
  }
  // Three separate deliveries while the first card is already revealing.
  await page.getByLabel("old cards", { exact: true }).fill("0")
  await page.getByLabel("new cards", { exact: true }).fill("1")
  await page.getByRole("button", { name: "设置旧状态", exact: true }).click()
  await page.getByRole("button", { name: "RESET CARD", exact: true }).click()
  await page.getByLabel("old cards", { exact: true }).fill("1")
  await page.getByLabel("new cards", { exact: true }).fill("2")
  await page.getByRole("button", { name: "RESET CARD", exact: true }).click()
  await page.getByLabel("old cards", { exact: true }).fill("2")
  await page.getByLabel("new cards", { exact: true }).fill("3")
  await page.getByRole("button", { name: "RESET CARD", exact: true }).click()
  await expect(page.locator(".reward-artifact-quantity")).toHaveText("×3")
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  await expect(page.locator(".quota-reset-count")).toContainText("×3")
  results.push({ test: "three in-flight grants aggregate without restarting", result: "PASS" })
  // A newer snapshot cancels stale visual interpolation and a network failure never creates a success scene.
  await page.getByRole("button", { name: "FULL RESET", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
  await page.getByRole("button", { name: "NETWORK FAILURE / RECOVER", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  await expect(page.locator(".quota-orb-number")).toHaveText("—")
  await page.getByRole("button", { name: "NETWORK FAILURE / RECOVER", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  results.push({ test: "failed refresh cancels presentation, no success sequence", result: "PASS" })
  // Actual resize while in flight: frozen geometry is bounded; next receipt remeasures.
  await page.getByRole("button", { name: "RESET CARD", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
  await page.setViewportSize({ width: 900, height: 700 })
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  await page.getByRole("button", { name: "RESET CARD", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
  const target = await page.locator(".reward-motion-layer").evaluate((el) => ({
    x: parseFloat(el.style.getPropertyValue("--target-x")),
    y: parseFloat(el.style.getPropertyValue("--target-y")),
  }))
  expect(target.x).toBeLessThan(900)
  expect(target.y).toBeLessThan(700)
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  results.push({ test: "resize during flight and next geometry measurement", result: "PASS", target })
  // Capture frame pacing; this is a measured browser sample, not a cross-platform performance claim.
  await page.setViewportSize({ width: 1440, height: 900 })
  const pacing = page.evaluate(
    () =>
      new Promise((resolve) => {
        let started = false,
          last = performance.now()
        const deltas = []
        const tick = (now) => {
          const live = !!document.querySelector(".reward-motion-layer")
          if (live) {
            if (started) deltas.push(now - last)
            started = true
          }
          if (started && !live) {
            resolve(deltas)
            return
          }
          last = now
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
  await page.getByRole("button", { name: "FULL RESET", exact: true }).click()
  const deltas = await pacing
  results.push({
    test: "frame pacing macOS headless Chromium DPR2",
    frames: deltas.length,
    medianMs: deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)],
    p95Ms: deltas[Math.floor(deltas.length * 0.95)],
  })
  await page.waitForTimeout(6200)
  expect(await page.locator(".reward-motion-layer,.reward-motes,.reward-arrival").count()).toBe(0)
  results.push({ test: "all reward layers and particles removed after completion", result: "PASS" })
  expect(errors).toEqual([])
} finally {
  writeFileSync("e2e/artifacts/reward-motion/matrix.json", JSON.stringify({ results, errors }, null, 2))
  await browser.close()
}
console.log(JSON.stringify(results, null, 2))
