import { chromium, expect } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
const dir = resolve(process.env.REWARD_QA_ARTIFACTS || "e2e/artifacts/reward-motion")
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
const scenarios = [
  ["full-reset-1x", "FULL RESET", "1", false, true],
  ["reset-card-1x", "RESET CARD", "1", false, true],
  ["full-reset-half", "FULL RESET", "0.5", false, true],
  ["reset-card-half", "RESET CARD", "0.5", false, false],
  ["reduced-motion", "MULTIPLE REWARDS", "1", true, true],
]
try {
  for (const [name, button, speed, reduced, panel] of scenarios) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "zh-CN",
      reducedMotion: reduced ? "reduce" : "no-preference",
      recordVideo: { dir, size: { width: 1440, height: 900 } },
    })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (e) => {
      errors.push(e.message)
      console.error("PAGE ERROR", e.stack)
    })
    await page.goto("http://127.0.0.1:4198")
    await expect(page.locator(".quota-orb-number")).toHaveText("20%")
    if (panel) await page.locator('[data-reward-anchor="orb"]').click()
    await page.getByLabel("speed", { exact: true }).selectOption(speed)
    await page.getByLabel("composer", { exact: true }).fill("奖励过程中保留的草稿")
    await page.waitForTimeout(300)
    await page.getByRole("button", { name: button, exact: true }).click()
    await page.getByLabel("composer", { exact: true }).focus()
    await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
    if (!reduced) {
      await page.waitForTimeout(630 / Number(speed))
      await page.screenshot({ path: `${dir}/${name}-reveal.png` })
    }
    if (button === "RESET CARD") {
      const geometry = await page
        .locator(".reward-motion-layer")
        .evaluate((el) =>
          Object.fromEntries(
            ["--flight-x", "--flight-y", "--target-x", "--target-y"].map((k) => [k, el.style.getPropertyValue(k)]),
          ),
        )
      expect(geometry["--flight-x"]).not.toBe("")
      results.push({ name, geometry })
    }
    await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 10000 })
    await expect(page.locator(".reward-arrival")).toBeVisible()
    await expect(page.getByLabel("composer", { exact: true })).toHaveValue("奖励过程中保留的草稿")
    await expect(page.getByLabel("composer", { exact: true })).toBeFocused()
    if (button === "FULL RESET") await expect(page.locator(".quota-orb-number")).toHaveText("100%")
    await page.screenshot({ path: `${dir}/${name}-settled.png` })
    await page.getByRole("button", { name: "DUPLICATE", exact: true }).click()
    await page.waitForTimeout(250)
    await expect(page.locator(".reward-motion-layer")).toHaveCount(0)
    expect(errors).toEqual([])
    await page.waitForTimeout(400)
    const video = page.video()
    await context.close()
    await video.saveAs(`${dir}/${name}.webm`)
    results.push({ name, result: "PASS", errors })
    console.log("PASS", name)
  }
  // Real rendering at additional window sizes, including resize during flight.
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1440],
    [768, 640],
    [420, 600],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    await page.goto("http://127.0.0.1:4198")
    await expect(page.locator(".quota-orb-number")).toHaveText("20%")
    await page.getByRole("button", { name: "RESET CARD", exact: true }).click()
    await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
    await page.waitForTimeout(600)
    const bounds = await page.locator(".reward-artifact").boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `${dir}/card-${width}x${height}.png` })
    await expect(page.locator(".reward-motion-layer")).toHaveCount(0)
    results.push({ name: `viewport ${width}x${height}`, result: "PASS" })
    await context.close()
  }
} finally {
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
