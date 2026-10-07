import { expect, test } from "@playwright/test"
import { setupHubuProjectChat } from "./hubu-projects.fixture"
import { campusFixture } from "./hubu-features-base.fixture"

test.skip(process.env.BRAND !== "hubu", "Requires HUBU")
const draft = `/new-session?draftId=${campusFixture.draftID}`

test("groups real sessions, remembers organization, and creates a draft in its project", async ({ page }) => {
  const fixture = await setupHubuProjectChat(page)
  await page.goto("/projects")
  const sidebar = page.getByRole("region", { name: "项目和会话" })
  const project = sidebar.getByRole("region", { name: "中国经济档案", exact: true })
  await expect(project.getByRole("button", { name: /^网页制作与本地预览/ })).toBeVisible()
  await project.getByRole("button", { name: "中国经济档案", exact: true }).click()
  await expect(project.getByRole("button", { name: /^网页制作与本地预览/ })).toBeHidden()
  await page.reload()
  await expect(project.getByRole("button", { name: "中国经济档案", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await project.getByRole("button", { name: "中国经济档案", exact: true }).click()
  const mutations: string[] = []
  page.on("request", (request) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) mutations.push(request.url())
  })
  await project.getByRole("button", { name: "整理“网页制作与本地预览”" }).click()
  await page.getByRole("menuitem", { name: "独立会话", exact: true }).click()
  const independent = sidebar.getByRole("region", { name: "独立会话", exact: true })
  await expect(independent.getByRole("button", { name: /^网页制作与本地预览/ })).toBeVisible()
  await page.reload()
  await expect(independent.getByRole("button", { name: /^网页制作与本地预览/ })).toBeVisible()
  expect(fixture.session.directory).toBe(campusFixture.directory)
  expect(mutations).toEqual([])
  await sidebar.getByRole("tab", { name: "最近", exact: true }).click()
  await expect(
    sidebar.getByRole("region", { name: "最近任务" }).getByRole("button", { name: /^网页制作与本地预览/ }),
  ).toBeVisible()
  await sidebar.getByRole("tab", { name: "项目", exact: true }).click()
  await sidebar.getByRole("button", { name: "在“HUBU”中新建会话", exact: true }).click()
  await expect(page).toHaveURL(/new-session\?draftId=(?!draft_campus_lake)/)
  await expect(page.locator('[data-action="prompt-project"]')).toContainText("HUBU")
})

test("deletes a current chat only after confirmation and keeps other projects", async ({ page }) => {
  const fixture = await setupHubuProjectChat(page)
  await page.goto("/projects")
  const sidebar = page.getByRole("region", { name: "项目和会话" })
  await sidebar.getByRole("button", { name: "整理“网页制作与本地预览”" }).click()
  await page.getByRole("menuitem", { name: "删除会话", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true })
  await expect(dialog).toContainText("本地文件保留")
  await expect(dialog.getByRole("button", { name: "删除会话", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  expect(fixture.deletions).toEqual([])
  await sidebar.getByRole("button", { name: "整理“网页制作与本地预览”" }).click()
  await page.getByRole("menuitem", { name: "删除会话", exact: true }).click()
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(sidebar.getByRole("button", { name: /^网页制作与本地预览/ })).toHaveCount(0)
  await expect(page).toHaveURL(/projects/)
  expect(fixture.deletions).toEqual([{ id: campusFixture.sessionID, directory: campusFixture.directory }])
  expect(fixture.sessions.some((s) => s.id === "ses_hubu_product")).toBe(true)
})

test("removes a project without DELETE, persists it and restores it by opening the folder", async ({ page }) => {
  const fixture = await setupHubuProjectChat(page)
  await page.route(
    (url) => url.pathname === "/find/file",
    (route) => route.fulfill({ json: ["campus-lake-demo"], headers: { "access-control-allow-origin": "*" } }),
  )
  await page.goto("/projects")
  const sidebar = page.getByRole("region", { name: "项目和会话" })
  await sidebar.getByRole("button", { name: "项目“中国经济档案”的操作" }).click()
  await page.getByRole("menuitem", { name: "移除项目", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "移除项目", exact: true })
  await dialog.getByRole("button", { name: "移除项目", exact: true }).click()
  await expect(sidebar.getByRole("region", { name: "中国经济档案", exact: true })).toHaveCount(0)
  const independent = sidebar.getByRole("region", { name: "独立会话", exact: true })
  await expect(independent.getByRole("button", { name: /^网页制作与本地预览/ })).toBeVisible()
  await page.reload()
  await expect(sidebar.getByRole("region", { name: "中国经济档案", exact: true })).toHaveCount(0)
  expect(fixture.deletions).toEqual([])
  expect(fixture.sessions).toHaveLength(6)
  await page.getByRole("button", { name: "打开项目", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "打开项目", exact: true })
  await picker.getByPlaceholder("搜索文件夹").fill("campus-lake-demo")
  await expect(picker.locator("[data-directory-path]")).toHaveCount(1)
  expect(
    (await picker.locator("[data-directory-path]").getAttribute("data-directory-path"))?.replaceAll("\\", "/"),
  ).toBe(campusFixture.directory)
  await picker.locator("[data-directory-path]").click()
  await page.goto("/projects")
  await expect(sidebar.getByRole("region", { name: "中国经济档案", exact: true })).toBeVisible()
})

test("batch deletion retains failed chats and retries only failures", async ({ page }) => {
  const fixture = await setupHubuProjectChat(page)
  fixture.failures.ses_hubu_history = 1
  fixture.sessions.push({
    ...fixture.session,
    id: "ses_hubu_child",
    parentID: campusFixture.sessionID,
    title: "子会话",
  })
  await page.goto("/projects")
  const sidebar = page.getByRole("region", { name: "项目和会话" })
  await sidebar.getByRole("button", { name: "项目“中国经济档案”的操作" }).click()
  await page.getByRole("menuitem", { name: "删除项目及会话", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "删除项目及会话", exact: true })
  await expect(dialog).toContainText("含子会话共：4")
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click()
  await expect(dialog.getByRole("status")).toHaveText("已删除：2；未删除：1。重试仅处理未删除的会话。")
  await expect(page.getByRole("region", { name: "中国经济档案", exact: true, includeHidden: true })).toBeAttached()
  await dialog.getByRole("button", { name: "重试未删除会话", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(sidebar.getByRole("region", { name: "中国经济档案", exact: true })).toHaveCount(0)
  expect(fixture.deletions.map((d) => d.id)).toEqual([
    campusFixture.sessionID,
    "ses_hubu_history",
    "ses_hubu_map",
    "ses_hubu_history",
  ])
  expect(fixture.sessions.map((s) => s.id).sort()).toEqual([
    "ses_hubu_campus",
    "ses_hubu_independent",
    "ses_hubu_product",
  ])
})

test("running child prevents deletion and a new child requires renewed confirmation", async ({ page }) => {
  const fixture = await setupHubuProjectChat(page)
  fixture.sessions.push({
    ...fixture.session,
    id: "ses_hubu_child",
    parentID: campusFixture.sessionID,
    title: "运行中的子会话",
  })
  fixture.running.add("ses_hubu_child")
  await page.goto("/projects")
  const sidebar = page.getByRole("region", { name: "项目和会话" })
  await sidebar.getByRole("button", { name: "整理“网页制作与本地预览”" }).click()
  await page.getByRole("menuitem", { name: "删除会话", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true })
  await expect(dialog).toContainText("含子会话共：2")
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click()
  await expect(dialog).toContainText("请先停止任务再重试")
  expect(fixture.deletions).toEqual([])
  fixture.running.clear()
  fixture.sessions.push({
    ...fixture.session,
    id: "ses_hubu_newchild",
    parentID: campusFixture.sessionID,
    title: "新增子会话",
  })
  await dialog.getByRole("button", { name: "重试未删除会话", exact: true }).click()
  await expect(dialog).toContainText("子会话发生变化")
  expect(fixture.deletions).toEqual([])
  await dialog.getByRole("button", { name: "重新核对删除列表", exact: true }).click()
  await expect(dialog).toContainText("含子会话共：3")
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(fixture.deletions).toHaveLength(1)
})

test("independent/recent delete shares failure handling and locks controls during a request", async ({ page }) => {
  const fixture = await setupHubuProjectChat(page)
  fixture.failures.ses_hubu_independent = 1
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/projects")
  const sidebar = page.getByRole("region", { name: "项目和会话" })
  await sidebar.getByRole("tab", { name: "最近", exact: true }).click()
  await sidebar.getByRole("button", { name: "整理“灵感随记”" }).click()
  await page.getByRole("menuitem", { name: "删除会话", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true })
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click()
  await expect(dialog).toContainText("删除失败，请重试")
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  await sidebar.getByRole("tab", { name: "项目", exact: true }).click()
  const independent = sidebar.getByRole("region", { name: "独立会话", exact: true })
  await independent.getByRole("button", { name: "整理“灵感随记”" }).click()
  await page.getByRole("menuitem", { name: "删除会话", exact: true }).click()
  const gate = Promise.withResolvers<void>()
  fixture.control.beforeDelete = () => gate.promise
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "正在删除…", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled()
  await dialog.press("Escape")
  await expect(dialog).toBeVisible()
  gate.resolve()
  await expect(dialog).toBeHidden()
  await expect(independent.getByRole("button", { name: /^灵感随记/ })).toHaveCount(0)
  expect(fixture.deletions.map((d) => d.id)).toEqual(["ses_hubu_independent", "ses_hubu_independent"])
})

test("v2 deletion uses the compatible API and preserves unrelated chats", async ({ page }) => {
  const fixture = await setupHubuProjectChat(page, { protocol: "v2" })
  const mutations: string[] = []
  page.on("request", (request) => {
    if (["POST", "DELETE", "PATCH", "PUT"].includes(request.method())) mutations.push(new URL(request.url()).pathname)
  })
  await page.goto("/projects")
  const sidebar = page.getByRole("region", { name: "项目和会话" })
  await sidebar.getByRole("button", { name: "整理“史料整理”" }).click()
  await page.getByRole("menuitem", { name: "删除会话", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true })
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(sidebar.getByRole("button", { name: /^史料整理/ })).toHaveCount(0)
  expect(mutations).toEqual(["/api/session/ses_hubu_history"])
  expect(fixture.sessions).toHaveLength(5)
})

test("opens the global skill library and installer outside a conversation", async ({ page }) => {
  await setupHubuProjectChat(page)
  await page.route("**/api/skill/available*", (route) =>
    route.fulfill({ json: { data: [] }, headers: { "access-control-allow-origin": "*" } }),
  )
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/projects")
  await page.locator('[data-campus-nav="skills"]').click()
  const library = page.getByTestId("skill-library-page")
  await expect(library).toBeVisible()
  await library.getByRole("button", { name: "安装新技能", exact: true }).click()
  await expect(page.getByTestId("skill-install-dialog")).toBeVisible()
  expect(errors).toEqual([])
})
