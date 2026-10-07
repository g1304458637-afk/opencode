// Run after a local HUBU build. The real packaged renderer and sidecar use a
// temporary profile and loopback model fixture; no installed profile is opened.
import { _electron, expect } from "@playwright/test"
import { ZipWriter, Uint8ArrayWriter, TextReader } from "@zip.js/zip.js"
import { createServer } from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

const profile = mkdtempSync(join(tmpdir(), "hubu-211-desktop-"))
const namespace = join(profile, "cn.edu.hubu.harness")
mkdirSync(namespace)
writeFileSync(join(namespace, "opencode.global.dat"), JSON.stringify({ language: JSON.stringify({ locale: "zh" }) }))
const artifacts = resolve(process.env.CAMPUS_E2E_ARTIFACTS ?? "e2e/artifacts/hubu-2.1.11")
mkdirSync(artifacts, { recursive: true })
const archive = new ZipWriter(new Uint8ArrayWriter())
await archive.add(
  "SKILL.md",
  new TextReader(
    "---\nname: hubu-local-fixture\ndescription: Local independent HUBU skill\n---\nHUBU_SKILL_SENTINEL_211: Answer using the original skill instructions.\n",
  ),
)
const zip = join(profile, "hubu-fixture.zip")
writeFileSync(zip, await archive.close())
const requests = []
const paths = []
const fixture = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString()
  const url = new URL(request.url, "http://localhost")
  paths.push(url.pathname)
  response.setHeader("Content-Type", "application/json")
  if (url.pathname.endsWith("/exchange"))
    return response.end(
      JSON.stringify({
        data: {
          gateway,
          brand: "hubu",
          audience: "hubu:desktop",
          api_key: "isolated-hubu-fixture-key",
          key_name: "local-verification",
          user: "isolated-fixture",
        },
      }),
    )
  if (url.pathname === "/v1/models") return response.end(JSON.stringify({ data: [{ id: "hubu-fixture-model" }] }))
  if (url.pathname === "/v1/usage")
    return response.end(
      JSON.stringify({
        mode: "unrestricted",
        wallet: { balance: "100", canonical_currency: "USD" },
        reset_cards: { available: 0 },
        usage: { today: { cost: 0, requests: 0 }, total: { cost: 0, requests: 0 } },
      }),
    )
  if (url.pathname === "/v1/chat/completions") {
    const data = JSON.parse(body)
    requests.push(data)
    const content = JSON.stringify(data.messages).includes("Translate the user-facing skill name")
      ? JSON.stringify({ name: "本机验证技能", description: "独立 HUBU 本地技能", skillMarkdown: "本机技能中文说明。" })
      : JSON.stringify(data.messages).includes("You are a title generator")
        ? "HUBU 技能验证"
        : "已使用所选技能的原始指令。"
    if (data.stream) {
      response.setHeader("Content-Type", "text/event-stream")
      response.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: data.model, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`,
      )
      response.end(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: data.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
      )
      return
    }
    return response.end(
      JSON.stringify({
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: data.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
  }
  response.writeHead(404)
  response.end(JSON.stringify({ error: { message: "Local fixture: unavailable" } }))
})
await new Promise((done) => fixture.listen(0, "127.0.0.1", done))
const gateway = `http://127.0.0.1:${fixture.address().port}`
let application
async function launch() {
  application = await _electron.launch({
    executablePath: process.env.CAMPUS_E2E_ELECTRON,
    args: [resolve("e2e/launch.mjs")],
    env: {
      ...process.env,
      CAMPUS_E2E_PROFILE: profile,
      CAMPUS_E2E_MAIN: resolve(
        process.env.CAMPUS_E2E_MAIN ?? "dist/hubu-2.1.11/win-unpacked/resources/app.asar/out/main/index.js",
      ),
      HUBU_GATEWAY_URL: gateway,
      HUBU_SKILL_REGISTRY_URL: `${gateway}/offline-registry/`,
      HUBU_DISABLE_AUTO_UPDATE: "1",
      OPENCODE_CHANNEL: "hubu",
      BRAND: "hubu",
      MUC_CDP_PORT: "0",
      NODE_ENV: "test",
    },
    timeout: 60000,
  })
  const page = await application.firstWindow({ timeout: 60000 })
  application.process().stderr.on("data", (chunk) => console.error(chunk.toString()))
  page.on("response", async (response) => {
    if (response.url().includes("skill") && response.status() >= 400)
      console.error("SKILL_ERROR", response.url(), response.status(), await response.text().catch(() => ""))
  })
  await page.waitForFunction(() => !!window.api?.mucConnect)
  await application.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, zip)
  return page
}
try {
  let page = await launch()
  expect(await page.evaluate(() => window.api.mucConnect("hubu_fixture_authorization_code_211"))).toMatchObject({
    ok: true,
  })
  // The real login gate relaunches after saving credentials: utility-process
  // environment variables are captured at fork, so a renderer reload is insufficient.
  await application.close()
  application = undefined
  page = await launch()
  const sidebar = () => page.locator('.campus-sidebar[data-brand="hubu"]')
  await expect(sidebar()).toBeVisible({ timeout: 90000 })
  expect((await page.evaluate(() => window.api.mucGetBrand())).version).toBe("2.1.11")
  await expect(page).toHaveTitle("HUBU AI")
  await expect(sidebar().locator(".campus-sidebar__crest svg")).toHaveAttribute("viewBox", "140 80 620 620")
  for (const width of [1280, 1600]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(sidebar().locator(".campus-sidebar__name")).toHaveCSS("font-size", "21px")
    for (const name of ["sessions", "new", "projects", "commands", "settings", "skills", "project-groups"])
      await expect(sidebar().locator(`[data-campus-nav="${name}"]`)).toHaveCSS("font-size", "14px")
  }
  await page.screenshot({ path: join(artifacts, "workspace.png") })
  await sidebar()
    .locator(".campus-sidebar__brand")
    .screenshot({ path: join(artifacts, "brand.png") })
  await sidebar().locator('[data-campus-nav="skills"]').click()
  await expect(page.getByTestId("skill-library-page")).toBeVisible()
  await page.getByRole("button", { name: "安装新技能", exact: true }).click()
  await page.getByRole("button", { name: "从电脑导入", exact: true }).click()
  await page.getByRole("button", { name: "选择 ZIP 文件", exact: true }).click()
  await expect(page.getByTestId("skill-preview")).toBeVisible({ timeout: 30000 })
  await page.getByRole("button", { name: "安装", exact: true }).click()
  await expect(page.getByText("安装完成，可以使用", { exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByRole("button", { name: "完成", exact: true }).click()
  await expect(page.locator(".skill-row").filter({ hasText: "hubu-local-fixture" })).toBeVisible()
  await expect(page.locator(".skill-row").filter({ hasText: "hubu-local-fixture" })).toContainText("本机验证技能", {
    timeout: 60000,
  })
  await page.screenshot({ path: join(artifacts, "local-skill-installed.png") })
  await application.close()
  application = undefined
  page = await launch()
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect(sidebar()).toBeVisible({ timeout: 90000 })
  await sidebar().locator('[data-campus-nav="skills"]').click()
  const installed = page.locator(".skill-row").filter({ hasText: "hubu-local-fixture" })
  await expect(installed).toBeVisible({ timeout: 30000 })
  await sidebar().locator('[data-campus-nav="new"]').click()
  await page.locator('[data-action="prompt-attach"]').click()
  await page.locator('[data-action="prompt-skills"]').click()
  const selected = page.getByTestId("skill-selector").getByRole("checkbox").filter({ hasText: "hubu-local-fixture" })
  await selected.click()
  await expect(selected).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("selected-skills")).toContainText(/hubu-local-fixture|本机验证技能/)
  await page.reload()
  await expect(page.getByTestId("selected-skills")).toContainText(/hubu-local-fixture|本机验证技能/, { timeout: 30000 })
  await expect(page.locator('[data-action="prompt-attach"]')).toBeInViewport()
  await expect(page.locator(".campus-new-session__hero h1")).toHaveCSS("opacity", "1")
  await page.screenshot({ path: join(artifacts, "task-skill-restored.png") })
  await page.locator('[data-component="prompt-input"]').fill("HUBU_EXECUTION_CHECK_211: Apply the selected skill.")
  await page.locator('[data-action="prompt-submit"]').click()
  const isExecution = (request) =>
    request.stream && request.tools?.length > 0 && JSON.stringify(request).includes("HUBU_EXECUTION_CHECK_211")
  await expect.poll(() => requests.some(isExecution), { timeout: 60000 }).toBe(true)
  const execution = requests.find(isExecution)
  expect(JSON.stringify(execution)).toContain("HUBU_SKILL_SENTINEL_211")
  expect(execution.model).toBe("hubu-fixture-model")
  // Desktop uses an in-memory router; the oc:// document URL stays constant.
  await expect(page.locator("[data-message-id]").filter({ hasText: "HUBU_EXECUTION_CHECK_211" }).first()).toBeVisible()
  await expect(page.locator('[data-action="prompt-submit"]')).toBeDisabled({ timeout: 30000 })
  await application.close()
  application = undefined
  page = await launch()
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect(sidebar()).toBeVisible({ timeout: 90000 })
  await expect(page.getByTestId("selected-skills")).toContainText(/hubu-local-fixture|本机验证技能/, { timeout: 30000 })
  // Restored drafts can paint before the dynamic model catalog finishes loading.
  await expect(page.locator('[data-action="prompt-model"]')).toContainText("hubu-fixture-model", { timeout: 30000 })
  await page.locator('[data-component="prompt-input"]').fill("HUBU_CONTINUE_CHECK_211: Continue the same task.")
  await page.locator('[data-action="prompt-submit"]').click()
  const isContinuation = (request) =>
    request.stream && request.tools?.length > 0 && JSON.stringify(request).includes("HUBU_CONTINUE_CHECK_211")
  await expect.poll(() => requests.some(isContinuation), { timeout: 60000 }).toBe(true)
  expect(JSON.stringify(requests.find(isContinuation))).toContain("HUBU_SKILL_SENTINEL_211")
  await expect(page.locator('[data-action="prompt-submit"]')).toBeDisabled({ timeout: 30000 })
  await page.getByTestId("selected-skills").getByRole("button").click()
  // Wait for the actual desktop draft transaction before destroying the renderer.
  // The isolated fixture creates exactly one submitted session.
  const userData = await application.evaluate(({ app }) => app.getPath("userData"))
  await expect
    .poll(() => {
      const db = new DatabaseSync(join(userData, "drafts.sqlite"), { readOnly: true })
      try {
        const rows = db.prepare("SELECT value FROM document WHERE key LIKE '%:session:%:prompt'").all()
        if (rows.length !== 1) return false
        const state = JSON.parse(rows[0].value)
        return Array.isArray(state.skills) && state.skills.length === 0 && state.skillOrigin === undefined
      } finally {
        db.close()
      }
    })
    .toBe(true)
  await page.reload()
  await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
  await expect(page.getByTestId("selected-skills")).toHaveCount(0)
  await page.locator('[data-component="prompt-input"]').fill("HUBU_CLEAR_CHECK_211: Continue without a selected skill.")
  await page.locator('[data-action="prompt-submit"]').click()
  const isCleared = (request) =>
    request.stream && request.tools?.length > 0 && JSON.stringify(request).includes("HUBU_CLEAR_CHECK_211")
  await expect.poll(() => requests.some(isCleared), { timeout: 60000 }).toBe(true)
  expect(JSON.stringify(requests.find(isCleared))).not.toContain("HUBU_SKILL_SENTINEL_211")
  await expect(page.locator('[data-action="prompt-submit"]')).toBeDisabled({ timeout: 30000 })
  await page.screenshot({ path: join(artifacts, "task-executed.png") })
  await sidebar().locator('[data-campus-nav="skills"]').click()
  const remaining = page.locator(".skill-row").filter({ hasText: "hubu-local-fixture" })
  await remaining.getByRole("button", { name: "移除", exact: true }).click()
  await expect(remaining).toHaveCount(0)
  const result = {
    passed: true,
    profile,
    version: "2.1.11",
    checks: [
      "identity",
      "crest",
      "21px/14px at 1280 and 1600",
      "native ZIP picker and local install",
      "Chinese translation through local model",
      "installed skill survives app restart",
      "task selection survives renderer restart",
      "legacy model request contains original skill",
      "submitted task selection survives app restart",
      "continuation executes the original revision",
      "explicit deselection survives reload and removes skill context",
      "offline local uninstall",
    ],
    modelRequests: requests.length,
  }
  writeFileSync(join(artifacts, "result.json"), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  console.error("DESKTOP_E2E_FAILURE", error)
  console.error("FIXTURE_PATHS", JSON.stringify(paths))
  if (application)
    await application
      .firstWindow()
      .then((page) => page.screenshot({ path: join(artifacts, "failure.png") }))
      .catch(() => {})
  throw error
} finally {
  await application?.close()
  fixture.closeAllConnections()
  await new Promise((done) => fixture.close(done))
}
