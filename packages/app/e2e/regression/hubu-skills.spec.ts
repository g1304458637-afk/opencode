import { expect, test } from "@playwright/test"
import { setupHubuProjectChat } from "./hubu-projects.fixture"
import { campusFixture, setupCampusSession } from "./hubu-features-base.fixture"

test.skip(process.env.BRAND !== "hubu", "Requires HUBU")
const items = ["installed", "project", "builtin"].map((kind, index) => ({
  id: `sk_${String(index).repeat(64)}`,
  name: `${kind}-skill`,
  description: `${kind} English description`,
  sourceType: kind === "installed" ? "local" : kind,
  repository: "fixture",
  path: "SKILL.md",
  managed: kind === "installed",
  contentHash: String(index + 1).repeat(64),
  ...(kind === "installed" ? { revision: "1".repeat(64) } : {}),
}))
const identify = (source: { id?: string; reference?: { skillId: string } }) =>
  items.find((item) => item.id === (source.id ?? source.reference?.skillId))!

test("progressively translates every source, loads full text on demand, and preserves original search", async ({
  page,
}, testInfo) => {
  await setupHubuProjectChat(page)
  await page.route("**/api/skill/available*", (route) => route.fulfill({ json: { data: items } }))
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let active = 0
  let peak = 0
  let fullRequests = 0
  await page.route("**/api/skill/translate*", async (route) => {
    const body = route.request().postDataJSON()
    const item = identify(body.source)
    active++
    peak = Math.max(peak, active)
    if (body.includeMarkdown) fullRequests++
    if (item.managed && !body.includeMarkdown) await held
    await route.fulfill({
      json: {
        data: {
          name: `中文${item.name}`,
          description: `中文简介${item.name}`,
          ...(body.includeMarkdown ? { skillMarkdown: "# 中文完整说明\n运行 `npm run build`。" } : {}),
        },
      },
    })
    active--
  })
  await page.route("**/api/skill/content*", (route) =>
    route.fulfill({
      json: {
        data: {
          name: "installed-skill",
          description: "English description",
          contentHash: "1".repeat(64),
          skillMarkdown: "# Original instructions\nRun `npm run build`.",
        },
      },
    }),
  )
  await page.goto(`/new-session?draftId=${campusFixture.draftID}`)
  await page.locator('[data-campus-nav="skills"]').click()
  const library = page.getByTestId("skill-library-page")
  await expect(library.getByText("installed-skill", { exact: true })).toBeVisible()
  await library.getByText("项目与内置技能", { exact: true }).click()
  await expect(library.getByText("中文project-skill", { exact: true })).toBeVisible()
  await expect(library.getByText("中文builtin-skill", { exact: true })).toBeVisible()
  expect(fullRequests).toBe(0)
  release()
  await expect(library.getByText("中文installed-skill", { exact: true })).toBeVisible()
  expect(peak).toBeLessThanOrEqual(2)
  await library.getByPlaceholder("搜索已安装的技能").fill("中文installed")
  await expect(library.locator("[data-skill-id]")).toHaveCount(1)
  await library.getByPlaceholder("搜索已安装的技能").fill("installed-skill")
  await library.getByRole("button", { name: "查看详情", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.locator("pre")).toContainText("中文完整说明")
  await dialog.getByRole("button", { name: "查看原文", exact: true }).click()
  await expect(dialog.locator("pre")).toContainText("# Original instructions")
  await dialog.getByRole("button", { name: "显示中文译文", exact: true }).click()
  await expect(dialog.locator("pre")).toContainText("中文完整说明")
  expect(fullRequests).toBe(1)
  await page.screenshot({ path: testInfo.outputPath("skill-chinese-details.png") })
})

test("reports missing models, provides settings, and retries a failed translation", async ({ page }) => {
  await setupHubuProjectChat(page)
  await page.route("**/api/skill/available*", (route) => route.fulfill({ json: { data: [items[0]] } }))
  let calls = 0
  await page.route("**/api/skill/translate*", (route) => {
    calls++
    if (calls === 1)
      return route.fulfill({
        status: 400,
        json: {
          _tag: "SkillLibraryFailure",
          code: "MODEL_UNAVAILABLE",
          stage: "validating",
          message: "No supported configured model is available for skill translation",
        },
      })
    return route.fulfill({ json: { data: { name: "已恢复中文技能", description: "已恢复中文简介" } } })
  })
  await page.goto(`/new-session?draftId=${campusFixture.draftID}`)
  await page.locator('[data-campus-nav="skills"]').click()
  const library = page.getByTestId("skill-library-page")
  await expect(library.getByText("没有可用的模型，请在设置中配置模型。", { exact: true })).toBeVisible()
  await expect(library.getByRole("button", { name: /设置/ })).toBeVisible()
  await library.getByRole("button", { name: "重试翻译", exact: true }).click()
  await expect(library.getByText("已恢复中文技能", { exact: true })).toBeVisible()
  await expect(library.getByRole("button", { name: "重试翻译", exact: true })).toHaveCount(0)
  expect(calls).toBe(2)
})

test("searches the independent registry, previews before install, and removes only the selected skill", async ({
  page,
}) => {
  await setupHubuProjectChat(page)
  const installed: typeof items = []
  const source = {
    ...items[0],
    revision: "1".repeat(64),
    artifactUrl: "http://127.0.0.1:4096/artifact.zip",
    artifactHash: "2".repeat(64),
  }
  const reads: unknown[] = []
  const operations: unknown[] = []
  await page.route("**/api/skill/available*", (route) => route.fulfill({ json: { data: installed } }))
  await page.route("**/api/skill/search*", (route) => {
    expect(new URL(route.request().url()).searchParams.get("q")).toBe("research")
    return route.fulfill({ json: { data: [source] } })
  })
  await page.route("**/api/skill/read*", (route) => {
    reads.push(route.request().postDataJSON().source)
    return route.fulfill({
      json: {
        data: {
          type: "preview",
          preview: { ...source, previewId: "3".repeat(64), skillMarkdown: "# Original research instructions" },
        },
      },
    })
  })
  await page.route("**/api/skill/translate*", (route) =>
    route.fulfill({ json: { data: { name: "研究技能", description: "整理资料", skillMarkdown: "# 研究说明" } } }),
  )
  await page.route("**/api/skill/install*", (route) => {
    const body = route.request().postDataJSON()
    operations.push(body)
    installed.push(items[0])
    return route.fulfill({
      json: { data: { id: body.id, stage: "completed", updatedAt: 1, result: { ...items[0], installedAt: 1 } } },
    })
  })
  await page.route("**/api/skill/library/*", (route) => {
    expect(route.request().method()).toBe("DELETE")
    expect(new URL(route.request().url()).pathname.split("/").at(-1)).toBe(items[0].id)
    installed.splice(0)
    return route.fulfill({ json: { data: true } })
  })
  await page.goto("/skills")
  const library = page.getByTestId("skill-library-page")
  await library.getByRole("button", { name: "安装新技能", exact: true }).click()
  const installer = page.getByTestId("skill-install-dialog")
  await installer.getByLabel("技能名称或公开 GitHub 链接", { exact: true }).fill("research")
  await installer.getByRole("button", { name: "查找 / 安装链接", exact: true }).click()
  await page
    .getByTestId("skill-search-results")
    .getByRole("button", { name: /installed-skill/ })
    .click()
  await expect(page.getByTestId("skill-preview")).toContainText("研究技能")
  expect(operations).toHaveLength(0)
  expect(reads).toEqual([{ type: "registry", id: source.id, revision: source.revision }])
  await installer.getByRole("button", { name: "安装", exact: true }).click()
  await expect(installer.getByRole("status")).toHaveText("安装完成，可以使用")
  await installer.getByRole("button", { name: "完成", exact: true }).click()
  await expect(library.getByText("研究技能", { exact: true })).toBeVisible()
  expect(operations).toHaveLength(1)
  await library.getByRole("button", { name: "移除", exact: true }).click()
  await expect(library.locator("[data-skill-id]")).toHaveCount(0)
})

test("registry outage leaves installed skills usable and permits explicit search retry", async ({ page }) => {
  await setupHubuProjectChat(page)
  await page.route("**/api/skill/available*", (route) => route.fulfill({ json: { data: [items[0]] } }))
  await page.route("**/api/skill/translate*", (route) =>
    route.fulfill({ json: { data: { name: "本机可用技能", description: "已安装" } } }),
  )
  let calls = 0
  await page.route("**/api/skill/search*", (route) => {
    calls++
    return calls === 1
      ? route.fulfill({ status: 503, json: { message: "技能目录暂时不可用" } })
      : route.fulfill({ json: { data: [] } })
  })
  await page.goto("/skills")
  const library = page.getByTestId("skill-library-page")
  await expect(library.getByText("本机可用技能", { exact: true })).toBeVisible()
  await library.getByRole("button", { name: "安装新技能", exact: true }).click()
  const installer = page.getByTestId("skill-install-dialog")
  await installer.getByLabel("技能名称或公开 GitHub 链接", { exact: true }).fill("research")
  await installer.getByRole("button", { name: "查找 / 安装链接", exact: true }).click()
  await expect(installer.getByRole("alert")).toContainText("技能目录暂时不可用")
  await installer.getByRole("button", { name: "查找 / 安装链接", exact: true }).click()
  await expect(page.getByTestId("skill-search-results")).toContainText("还没有可用技能")
  await page.keyboard.press("Escape")
  await expect(library.getByText("本机可用技能", { exact: true })).toBeVisible()
  expect(calls).toBe(2)
})

test("task skill selection is restored after reload, isolated from new tasks, and admitted with an immutable version", async ({
  page,
}) => {
  const fixture = await setupCampusSession(page)
  await page.route("**/api/skill/available*", (route) => route.fulfill({ json: { data: [items[0]] } }))
  await page.route("**/api/skill/translate*", (route) =>
    route.fulfill({ json: { data: { name: "研究技能", description: "整理资料" } } }),
  )
  const selections: { owner: string; skills: { id: string; revision: string }[] }[] = []
  const reference = { skillId: items[0].id, revision: "1".repeat(64), contentHash: "1".repeat(64) }
  await page.route("**/api/skill/selection*", (route) => {
    selections.push(route.request().postDataJSON())
    return route.fulfill({ json: { data: [reference] } })
  })
  const draftUrl = "/new-session?draftId=" + campusFixture.draftID
  await page.goto(draftUrl)
  await page.locator('[data-action="prompt-attach"]').click()
  await page.getByRole("menuitem", { name: "添加技能", exact: true }).click()
  const picker = page.getByTestId("skill-selector")
  await picker.getByRole("checkbox", { name: /研究技能/ }).click()
  await expect(picker.getByRole("checkbox", { name: /研究技能/ })).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("selected-skills")).toContainText("研究技能")
  await page.reload()
  await expect(page.getByTestId("selected-skills")).toContainText("研究技能")
  await page.locator('[data-campus-nav="new"]').click()
  await expect(page).not.toHaveURL(new RegExp(campusFixture.draftID))
  await expect(page.getByTestId("selected-skills")).toHaveCount(0)
  await page.goto(draftUrl)
  await expect(page.getByTestId("selected-skills")).toContainText("研究技能")
  await page.locator('[data-component="prompt-input"]').fill("请按技能整理资料")
  await page.locator('[data-action="prompt-submit"]').click()
  await expect.poll(() => fixture.submitted.length).toBe(1)
  expect(selections).toHaveLength(1)
  expect(selections[0].skills).toEqual([{ id: items[0].id, revision: "1".repeat(64) }])
  expect(fixture.submitted[0]).toMatchObject({ messageID: selections[0].owner, selectedSkills: [reference] })
})
