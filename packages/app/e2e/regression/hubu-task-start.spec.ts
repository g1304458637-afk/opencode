import { expect, test } from "@playwright/test"
import { campusFixture, setupCampusSession } from "./hubu-features-base.fixture"

test.skip(process.env.BRAND !== "hubu", "Requires HUBU")

test("task starters retain HUBU hero, readable controls and model variants across window sizes", async ({
  page,
}, testInfo) => {
  await setupCampusSession(page)
  await page.goto("/new-session?draftId=" + campusFixture.draftID)
  const hero = page.locator('[data-component="session-new-design"]')
  const input = page.locator('[data-component="prompt-input"]')
  const heading = hero.getByRole("heading", { name: "描述你的想法，开始创造。", exact: true })
  await expect(heading).toHaveCSS("opacity", "1")
  await expect(page.locator(".campus-new-session__composer")).toHaveCSS("opacity", "1")
  await expect(input).toBeEditable()
  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 935, height: 522 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(input).toBeInViewport()
    await expect(page.locator('[data-action="prompt-submit"]')).toBeInViewport()
    const cards = page.locator("[data-task-starter]")
    await expect(cards).toHaveCount(6)
    expect(await cards.evaluateAll((nodes) => nodes.every((node) => node.scrollHeight <= node.clientHeight + 1))).toBe(
      true,
    )
    await page.screenshot({
      path: testInfo.outputPath("hubu-starters-" + viewport.width + "x" + viewport.height + ".png"),
      animations: "disabled",
    })
  }
  await input.fill("保留已有内容")
  await page.locator('[data-task-starter="code"]').click()
  await expect(input).toContainText("保留已有内容")
  await expect(input).toContainText("代码")
  await page.locator('[data-action="prompt-model"]').click()
  await expect(page.getByRole("menuitemradio", { name: "high", exact: true })).toBeVisible()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
})
