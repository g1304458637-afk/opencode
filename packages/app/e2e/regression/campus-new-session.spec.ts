import { expect, test } from "@playwright/test"
import { campusFixture, setupCampusSession } from "./campus-new-session.fixture"

const heroSelector = '[data-component="session-new-design"]'
const inputSelector = '[data-component="prompt-input"]'
const submitSelector = '[data-action="prompt-submit"]'
const brand = process.env.BRAND === "hubu" ? "HUBUCode" : "MUCode"

test("keeps long project names and long prompts inside a narrow, short window", async ({ page }, testInfo) => {
  const projectName = "Campus-research-project-with-a-very-long-name-and-no-breaks"
  await setupCampusSession(page, { projectName })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 320, height: 480 })
  await page.goto(`/new-session?draftId=${campusFixture.draftID}`)
  const hero = page.locator(heroSelector)
  await expect(hero.locator('[data-action="prompt-project"]')).toContainText(projectName)
  await hero.locator(inputSelector).fill("长内容与窄窗口验证。\n".repeat(50))
  await hero.locator(submitSelector).scrollIntoViewIfNeeded()
  await expect(hero.locator(submitSelector)).toBeInViewport()
  await expect.poll(() => hero.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`${brand}-320x480-long-content.png`), animations: "disabled" })
})

test("keeps the real composer usable at desktop, tablet, narrow and short sizes", async ({ page }, testInfo) => {
  await setupCampusSession(page, { video: process.env.CAMPUS_LIVE_VIDEO === "1" ? "live" : "fail" })
  await page.goto(`/new-session?draftId=${campusFixture.draftID}`)
  const hero = page.locator(heroSelector)
  await expect(hero.getByRole("heading", { name: "描述你的想法，开始创造。" })).toBeVisible()
  await expect(page.locator(".campus-sidebar__name")).toHaveText(brand)
  await expect(hero.locator(inputSelector)).toBeEditable()
  await expect(hero.locator('[data-action="prompt-model"]')).toContainText("Sonnet 4.5")
  await expect(hero.locator(submitSelector)).toBeDisabled()
  if (process.env.CAMPUS_LIVE_VIDEO === "1") {
    await expect(page.locator(".campus-workspace__background video")).toHaveAttribute("data-playing", "true", {
      timeout: 30000,
    })
  }
  for (const viewport of [
    { width: 1560, height: 1008 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 935, height: 522 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(hero.locator(submitSelector)).toBeInViewport()
    await expect(hero.getByRole("heading")).toBeInViewport()
    await expect.poll(() => hero.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect
      .poll(() => page.locator('[data-slot="prompt-toolbar"]').evaluate((node) => node.scrollWidth <= node.clientWidth))
      .toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`${brand}-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
    })
  }
  await hero.locator(inputSelector).fill("实现一个课程笔记应用。\n".repeat(40))
  await expect(hero.locator(submitSelector)).toBeEnabled()
  await expect(hero.locator(submitSelector)).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath(`${brand}-long-prompt.png`), animations: "disabled" })
  if (process.env.CAMPUS_LIVE_VIDEO === "1") {
    const video = await page.locator(".campus-workspace__background video").elementHandle()
    if (!video) throw new Error("The playing background is missing")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(page.locator(".campus-workspace__background video")).toHaveCount(0)
    expect(
      await video.evaluate((node) => node instanceof HTMLVideoElement && node.paused && !node.hasAttribute("src")),
    ).toBe(true)
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await expect(page.locator(".campus-workspace__background video")).toHaveAttribute("data-playing", "true")
    const resumed = await page.locator(".campus-workspace__background video").elementHandle()
    if (!resumed) throw new Error("The resumed background is missing")
    await page.locator(".campus-sidebar__brand").click()
    await expect(hero).toHaveCount(0)
    expect(await resumed.evaluate((node) => node instanceof HTMLVideoElement && node.isConnected && !node.paused)).toBe(
      true,
    )
  }
})

test("supports project, model and attachment controls and promotes a submitted draft", async ({ page }, testInfo) => {
  const fixture = await setupCampusSession(page)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(`/new-session?draftId=${campusFixture.draftID}`)
  const hero = page.locator(heroSelector)
  const input = hero.locator(inputSelector)
  await expect(input).toBeEditable()
  await hero.locator('[data-action="prompt-project"]').click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await hero.locator('[data-action="prompt-model"]').click()
  await page.getByText("Campus test model", { exact: true }).click()
  await expect(hero.locator('[data-action="prompt-model"]')).toContainText("Campus test model")
  await input.fill("创建一个课程笔记应用")
  const chooser = page.waitForEvent("filechooser")
  await hero.getByRole("button", { name: "添加图片和文件", exact: true }).click()
  await page.getByRole("menuitem", { name: "图片和文件" }).click()
  await (
    await chooser
  ).setFiles({ name: "requirements.txt", mimeType: "text/plain", buffer: Buffer.from("Local fixture only") })
  await expect(hero.getByText("requirements.txt", { exact: true })).toBeVisible()
  await expect(hero.locator(submitSelector)).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath(`${brand}-attachment.png`), animations: "disabled" })
  await hero.locator(submitSelector).click()
  await expect.poll(() => fixture.submitted.length).toBe(1)
  await expect(page).toHaveURL(new RegExp(`/session/${campusFixture.sessionID}`))
  expect(fixture.submitted[0]).toMatchObject({
    model: { providerID: "muc", modelID: "second-fixture" },
    parts: expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "创建一个课程笔记应用" }),
      expect.objectContaining({ type: "file", filename: "requirements.txt" }),
    ]),
  })
  await expect(hero).toHaveCount(0)
  await expect(page.locator(inputSelector)).toBeEditable()
  await expect(page.locator(submitSelector)).toHaveCSS("border-radius", "50%")
})

test("does not request video or animate with reduced motion and reacts to preference changes", async ({ page }) => {
  await setupCampusSession(page)
  let requests = 0
  page.on("request", (request) => {
    if (request.url() === campusFixture.video) requests += 1
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(`/new-session?draftId=${campusFixture.draftID}`)
  const hero = page.locator(heroSelector)
  await expect(hero.locator(inputSelector)).toBeEditable()
  await expect(page.locator(".campus-workspace__background video")).toHaveCount(0)
  await expect(hero.getByRole("heading")).toHaveCSS("animation-name", "none")
  expect(requests).toBe(0)
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect.poll(() => requests).toBeGreaterThan(0)
  await expect(page.locator(".campus-workspace__background video")).toHaveCount(0)
  await expect(page.locator(".campus-workspace__background img")).toBeVisible()
  await hero.locator(inputSelector).fill("视频失败后仍可输入")
  await expect(hero.locator(submitSelector)).toBeEnabled()
})
