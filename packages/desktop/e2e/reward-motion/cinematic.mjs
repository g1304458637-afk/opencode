import { chromium, expect } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
const dir = "e2e/artifacts/reward-cinematic"
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const intensity of ["High", "MAX"])
    for (const kind of ["reset", "card"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
      const page = await context.newPage(),
        errors = []
      page.on("pageerror", (e) => errors.push(e.message))
      await page.goto("http://127.0.0.1:4199")
      const panel = page.locator(".reward-preview")
      await expect(panel.getByRole("button", { name: "全额重置", exact: true })).toBeVisible()
      await panel.getByLabel("FX 强度", { exact: true }).selectOption(intensity)
      await panel.getByLabel("播放速度", { exact: true }).selectOption("1")
      await page.getByLabel("composer", { exact: true }).fill("保留我的草稿")
      const pacing = page.evaluate(
        () =>
          new Promise((resolve) => {
            const frames = []
            let seen = false,
              previous = performance.now()
            const tick = (now) => {
              const active = document.querySelector(".reward-motion-layer")
              if (active) {
                if (seen) frames.push(now - previous)
                seen = true
              }
              if (seen && !active) {
                resolve(frames)
                return
              }
              previous = now
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
      )
      await panel.getByRole("button", { name: kind === "reset" ? "全额重置" : "获得重置卡", exact: true }).click()
      await page.getByLabel("composer", { exact: true }).focus()
      await expect(page.locator(".reward-motion-layer")).toHaveAttribute("data-intensity", intensity)
      await page.waitForTimeout(kind === "reset" ? 1250 : 1180)
      const state = await page.locator(".reward-motion-layer").evaluate((el) => ({
        phase: el.dataset.phase,
        lowPower: el.dataset.lowPower,
        particles: el.querySelector("canvas").dataset.particles,
      }))
      const cdp = await context.newCDPSession(page)
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
      writeFileSync(`${dir}/${kind}-${intensity}.png`, Buffer.from(shot.data, "base64"))
      await cdp.detach()
      await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
      const frames = (await pacing).sort((a, b) => a - b)
      await expect(page.getByLabel("composer", { exact: true })).toHaveValue("保留我的草稿")
      await expect(page.getByLabel("composer", { exact: true })).toBeFocused()
      await expect(page.locator(".quota-orb-number")).toHaveText("20%")
      expect(errors).toEqual([])
      results.push({
        intensity,
        kind,
        ...state,
        frames: frames.length,
        median: frames[Math.floor(frames.length * 0.5)],
        p95: frames[Math.floor(frames.length * 0.95)],
        errors,
      })
      await context.close()
    }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto("http://127.0.0.1:4199")
  const panel = page.locator(".reward-preview")
  await expect(panel.getByLabel("播放速度", { exact: true })).toBeVisible()
  for (const speed of ["0.5", "0.25"]) {
    await panel.getByLabel("播放速度", { exact: true }).selectOption(speed)
    await panel.getByRole("button", { name: "全额重置", exact: true }).click()
    await expect(page.locator(".reward-motion-layer")).toHaveCount(1)
    await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 15000 })
    await expect(panel.locator(".reward-preview-readings")).toContainText("100%")
    results.push({ test: `slow motion ${speed}`, result: "PASS" })
  }
  await panel.getByLabel("播放速度", { exact: true }).selectOption("1")
  await panel.getByLabel("减少动态效果", { exact: true }).check()
  await panel.getByRole("button", { name: "获得重置卡", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveAttribute("data-reduced", "true")
  expect(await page.locator(".reward-fx-canvas").evaluate((el) => getComputedStyle(el).display)).toBe("none")
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  results.push({ test: "Reduced Motion separate treatment", result: "PASS" })
  await context.close()
  const audioContext = await browser.newContext({ viewport: { width: 1024, height: 720 }, deviceScaleFactor: 2 })
  await audioContext.addInitScript(() => {
    window.rewardAudioContexts = []
    const NativeAudio = window.AudioContext
    window.AudioContext = class extends NativeAudio {
      constructor(...args) {
        super(...args)
        window.rewardAudioContexts.push(this)
      }
    }
  })
  const audioPage = await audioContext.newPage()
  const audioErrors = []
  audioPage.on("pageerror", (e) => audioErrors.push(e.message))
  await audioPage.goto("http://127.0.0.1:4199")
  const audioPanel = audioPage.locator(".reward-preview")
  await audioPanel.getByLabel("奖励音效", { exact: true }).check()
  await audioPanel.getByRole("button", { name: "获得重置卡", exact: true }).click()
  await expect(audioPage.locator(".reward-motion-layer")).toHaveCount(1)
  await expect(audioPage.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  expect(await audioPage.evaluate(() => window.rewardAudioContexts.length)).toBe(1)
  expect(await audioPage.evaluate(() => window.rewardAudioContexts.every((c) => c.state === "closed"))).toBe(true)
  await audioPanel.getByRole("button", { name: "全额重置", exact: true }).click()
  await expect(audioPage.locator(".reward-motion-layer")).toHaveCount(1)
  await audioPanel.getByRole("button", { name: "收起动效预览", exact: true }).click()
  await expect(audioPage.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  expect(await audioPage.evaluate(() => window.rewardAudioContexts.length)).toBe(2)
  expect(await audioPage.evaluate(() => window.rewardAudioContexts.every((c) => c.state === "closed"))).toBe(true)
  expect(audioErrors).toEqual([])
  results.push({ test: "audio completion/cancel closes contexts; 1024px window", result: "PASS" })
  await audioContext.close()
} finally {
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
console.log(JSON.stringify(results, null, 2))
