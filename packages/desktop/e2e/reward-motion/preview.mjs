import { chromium, expect } from "@playwright/test"
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("http://127.0.0.1:4199")
  const panel = page.getByRole("complementary", { name: "动效预览", exact: true })
  await expect(panel).toBeVisible()
  await expect(panel.getByLabel("FX 强度", { exact: true })).toHaveValue("MAX")
  await expect(panel.getByLabel("播放速度", { exact: true })).toHaveValue("0.5")
  await page.locator('[data-reward-anchor="orb"]').click()
  await expect(page.locator(".quota-reset-count")).toContainText("×0")
  await panel.getByRole("button", { name: "获得重置卡", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveAttribute("data-kind", "RESET_CARD_GRANTED")
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  await expect(panel.locator(".reward-preview-readings")).toContainText("×1")
  await expect(page.locator(".quota-reset-count")).toContainText("×0")
  await panel.getByRole("button", { name: "全额重置", exact: true }).click()
  await expect(page.locator(".reward-motion-layer")).toHaveAttribute("data-kind", "FULL_RESET")
  await expect(page.locator(".reward-motion-layer")).toHaveCount(0, { timeout: 8000 })
  await expect(panel.locator(".reward-preview-readings")).toContainText("100%")
  await expect(page.locator(".quota-orb-number")).toHaveText("20%")

  const accountQuota = await page.locator(".quota-orb-number").textContent()
  const accountCards = await page.locator(".quota-reset-count").textContent()
  await page.evaluate(() => {
    const api = window.api
    const original = api.mucResetCard.bind(api)
    let calls = 0
    api.mucResetCard = (...args) => {
      calls += 1
      return original(...args)
    }
    Object.defineProperty(window, "__rewardPreviewResetCalls", { get: () => calls })
  })

  const useCard = panel.getByRole("button", { name: "模拟使用重置卡", exact: true })
  const startedAt = await page.evaluate(() => performance.now())
  await useCard.click()
  const usedMotion = page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')
  await expect(usedMotion).toBeVisible()
  await expect(usedMotion).toHaveAttribute("data-intensity", "MAX")
  await expect(usedMotion.locator(".reward-use-balance")).toContainText("×2")
  await expect(usedMotion.locator(".reward-hero-value")).toHaveText("20%")
  await expect(usedMotion).toHaveCount(0, { timeout: 8000 })
  const elapsed = (await page.evaluate(() => performance.now())) - startedAt
  expect(elapsed).toBeGreaterThanOrEqual(3800)
  expect(elapsed).toBeLessThan(6500)
  await expect(panel.locator(".reward-preview-readings")).toContainText("100%")
  await expect(panel.locator(".reward-preview-readings")).toContainText("×2")
  await expect(page.locator(".quota-orb-number")).toHaveText(accountQuota)
  await expect(page.locator(".quota-reset-count")).toHaveText(accountCards)
  expect(await page.evaluate(() => window.__rewardPreviewResetCalls)).toBe(0)

  await page.emulateMedia({ reducedMotion: "reduce" })
  await useCard.click()
  const reducedMotion = page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')
  await expect(reducedMotion).toBeVisible()
  await expect(reducedMotion).toHaveAttribute("data-reduced", "true")
  await expect(reducedMotion).toHaveCount(0, { timeout: 8000 })
  await expect(page.locator(".quota-orb-number")).toHaveText(accountQuota)
  await expect(page.locator(".quota-reset-count")).toHaveText(accountCards)
  expect(await page.evaluate(() => window.__rewardPreviewResetCalls)).toBe(0)

  await page.emulateMedia({ reducedMotion: "no-preference" })
  await useCard.click()
  const skippedMotion = page.locator('.reward-motion-layer[data-kind="RESET_CARD_USED"]')
  await expect(skippedMotion).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(skippedMotion).toHaveCount(0)
  await expect(page.locator(".quota-orb-number")).toHaveText(accountQuota)
  const quotaPanel = page.locator(".quota-panel")
  if (!(await quotaPanel.isVisible())) await page.locator('[data-reward-anchor="orb"]').click()
  await expect(page.locator(".quota-reset-count")).toHaveText(accountCards)
  expect(await page.evaluate(() => window.__rewardPreviewResetCalls)).toBe(0)

  await panel.getByRole("button", { name: "获得重置卡", exact: true }).click()
  await panel.getByRole("button", { name: "收起动效预览", exact: true }).click()
  await expect(page.locator(".reward-motion-layer,.reward-arrival")).toHaveCount(0, { timeout: 8000 })
  await panel.getByRole("button", { name: "动效预览", exact: true }).click()
  await expect(panel.getByRole("button", { name: "全额重置", exact: true })).toBeVisible()
  expect(errors).toEqual([])
  console.log(
    "PASS: all three preview actions, 4.2s default card-use scene, reduced motion, Escape skip, unchanged account state, no reset-card IPC, close cleanup and reopen; no recording",
  )
} finally {
  await browser.close()
}
