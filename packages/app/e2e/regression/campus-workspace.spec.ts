import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  userMessage,
  textPart,
  toolPart,
  setupTimeline,
  partUpdated,
  partDelta,
  status,
} from "../performance/timeline-stability/fixture"
import { campusFixture } from "./campus-new-session.fixture"

const sizes = [
  { width: 1672, height: 941 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1512, height: 982 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
  { width: 900, height: 640 },
  { width: 390, height: 720 },
  { width: 935, height: 522 },
]
const shell = (state: "running" | "completed") =>
  state === "running"
    ? toolPart("prt_0002_shell", "bash", "running", {
        command: "wc -w chapters/*.md",
        description: "统计章节与创作进度",
      })
    : toolPart(
        "prt_0002_shell",
        "bash",
        "completed",
        { command: "wc -w chapters/*.md", description: "统计章节与创作进度" },
        { output: "29928 total\n21 chapters" },
      )

test.skip(
  !["hubu", "muc"].includes(process.env.BRAND ?? ""),
  "Campus UI regressions require a campus-branded app build",
)

// Real renderer and schema-validated API fixtures. Never calls a model provider.
test("campus workspace keeps controls, tool state and streaming usable across sizes", async ({ page }, info) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route(campusFixture.video, (route) =>
    process.env.CAMPUS_VIDEO_FIXTURE
      ? route.fulfill({ path: process.env.CAMPUS_VIDEO_FIXTURE, contentType: "video/mp4" })
      : route.abort(),
  )
  const timeline = await setupTimeline(page, {
    viewport: sizes[0],
    locale: "zh",
    settings: { newLayoutDesigns: true, shouldDisplayTabsToast: false },
    messages: [
      userMessage([
        { id: "prt_request", type: "text", text: "梳理《青灯问道》的最新进度，并继续推进后续章节的创作。" },
      ]),
      assistantMessage([
        textPart("prt_0001_intro", "我正在为你梳理《青灯问道》最新进度，并继续推进后续章节的创作。"),
        shell("completed"),
        toolPart(
          "prt_0003_edit",
          "edit",
          "completed",
          { filePath: "进度追踪.md" },
          {
            output: "Updated",
            metadata: {
              filediff: { file: "进度追踪.md", additions: 10, deletions: 10, before: "第 11 章", after: "第 21 章" },
            },
          },
        ),
        toolPart(
          "prt_0004_read",
          "read",
          "completed",
          { filePath: "青灯问道/第二幕-挽落/" },
          { output: "Chapter notes\nCharacter arcs" },
        ),
        textPart(
          "prt_9999_summary",
          "## 本次工作总结\n\n本批次完成：第 12–21 章，全书正文累计 29,928 字 / 21 章。\n\n本批次剧情（卷一第二幕·挽落）：\n\n- **第 12–14 章**：灰先生撤下伪装，回春堂设伏重创洛檀，陈渡首次夜伤。\n- **第 15–16 章**：陈渡燃掉不想再被丢下的心愿突破灯罩境，护住长街百姓。\n- **第 17–19 章**：传檄交代后事，碎片提前异动，祝九更遍提照尽镇之名。\n- **第 20–21 章**：监正周衡登场，照一出黑买灯的卷一中案浮出水面。\n\n接下来将继续：第 22–31 章，推进人物线索与城中故事。",
        ),
      ]),
    ],
  })
  await expect(page.locator("body")).toHaveAttribute("data-campus-workspace", /hubu|muc/)
  const composer = page.locator('[data-component="prompt-input"]')
  await expect(composer).toBeEditable()
  expect(await composer.evaluate((el) => getComputedStyle(el, "::before").content)).toBe('"\u200B"')
  if (process.env.CAMPUS_VIDEO_FIXTURE)
    await expect(page.locator(".campus-workspace__background video")).toHaveAttribute("data-playing", "true")
  await expect(page.locator(".campus-workspace__background img")).toBeVisible()
  for (const size of sizes) {
    await page.setViewportSize(size)
    await expect(composer).toBeInViewport()
    await expect(page.locator('[data-action="prompt-submit"]')).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.locator('[data-component="session-panel"] [data-scrollable]').first().hover()
    await page.mouse.wheel(0, -20000)
    await timeline.settle(8)
    await page.screenshot({ path: info.outputPath(`workspace-${size.width}x${size.height}.png`) })
  }
  await page.setViewportSize(sizes[0])
  await page.locator('[data-component="prompt-input-v2"]').screenshot({ path: info.outputPath("composer-detail.png") })
  const wrapper = page.locator('[data-timeline-part-id="prt_0002_shell"]')
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await trigger.click()
  await expect(wrapper).toContainText("29928 total")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await wrapper.screenshot({ path: info.outputPath("tool-detail.png") })
  const context = page.locator('[data-timeline-part-ids="prt_0004_read"] [data-slot="collapsible-trigger"]')
  await context.click()
  await expect(context).toHaveAttribute("aria-expanded", "true")
  await context.click()
  await composer.fill("继续下一章。\n保持人物性格与时间线一致。")
  await timeline.send(partUpdated(shell("running")))
  await expect(wrapper).toHaveAttribute("data-status", "running")
  await expect(composer).toBeFocused()
  await timeline.send(partUpdated(shell("completed")))
  await expect(wrapper).toHaveAttribute("data-status", "completed")
  await timeline.send(status("busy"))
  await timeline.send(partDelta("prt_9999_summary", "\n\n新的章节规划已追加。"))
  await expect(page.locator('[data-timeline-part-id="prt_9999_summary"]')).toContainText("新的章节规划已追加")
  expect(await composer.innerText()).toBe("继续下一章。\n保持人物性格与时间线一致。")
  // The existing composer offers send/queue while a draft exists and stop when empty.
  await composer.fill("")
  await expect(page.locator('[data-action="prompt-submit"]')).toHaveAttribute("aria-label", "停止")
  await page.route("**/session/*/abort", (route) => route.fulfill({ json: true }))
  const aborted = page.waitForRequest((request) => request.url().endsWith("/abort") && request.method() === "POST")
  await page.locator('[data-action="prompt-submit"]').click()
  await aborted
  await timeline.send(status("idle"))
  await timeline.send(partDelta("prt_9999_summary", "\n\n```ts\nconst chapter = 22\n```"))
  await expect(page.locator('[data-timeline-part-id="prt_9999_summary"] pre')).toContainText("const chapter = 22")
  await timeline.send(
    partUpdated(toolPart("prt_0002_shell", "bash", "error", { command: "exit 1" }, { error: "本地验收：命令失败" })),
  )
  await expect(wrapper).toHaveAttribute("data-status", "error")
  await page.screenshot({ path: info.outputPath("workspace-error.png") })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(page.locator(".campus-workspace__background video")).toHaveCount(0)
  await expect(page.locator(".campus-workspace__background img")).toBeVisible()
  await page.locator('[data-campus-nav="settings"]').click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.screenshot({ path: info.outputPath("workspace-settings.png") })
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(errors).toEqual([])
})
