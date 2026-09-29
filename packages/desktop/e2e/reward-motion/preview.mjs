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
  await panel.getByRole("button", { name: "获得重置卡", exact: true }).click()
  await panel.getByRole("button", { name: "收起动效预览", exact: true }).click()
  await expect(page.locator(".reward-motion-layer,.reward-arrival")).toHaveCount(0, { timeout: 8000 })
  await panel.getByRole("button", { name: "动效预览", exact: true }).click()
  await expect(panel.getByRole("button", { name: "全额重置", exact: true })).toBeVisible()
  expect(errors).toEqual([])
  console.log(
    "PASS: both preview buttons, repeated playback, unchanged account cards/quota, close cleanup and reopen; no recording",
  )
} finally {
  await browser.close()
}
