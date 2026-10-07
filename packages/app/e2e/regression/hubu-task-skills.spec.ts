import { expect, test, type Page } from "@playwright/test"
import { campusFixture, setupCampusSession } from "./hubu-features-base.fixture"

test.skip(process.env.BRAND !== "hubu", "Requires HUBU")
const skill = {
  id: "sk_" + "4".repeat(64),
  name: "task-research",
  description: "Research",
  sourceType: "local",
  repository: "fixture",
  path: "SKILL.md",
  managed: true,
  revision: "5".repeat(64),
  contentHash: "5".repeat(64),
}
const reference = { skillId: skill.id, revision: skill.revision, contentHash: skill.contentHash }
type Submitted = { messageID: string; selectedSkills: (typeof reference)[]; parts: { type: string; text?: string }[] }
type Selection = { owner: string; restoreFrom?: string; skills: { id: string; revision?: string }[] }

function conversation(input: Submitted) {
  const { sessionID, directory } = campusFixture
  return [
    {
      info: {
        id: input.messageID,
        sessionID,
        role: "user",
        time: { created: 1700000000000 },
        agent: "build",
        model: { providerID: "muc", modelID: "sonnet-fixture" },
        selectedSkills: input.selectedSkills,
      },
      parts: input.parts.map((part, index) => ({
        ...part,
        id: "prt_user_" + index,
        messageID: input.messageID,
        sessionID,
      })),
    },
    {
      info: {
        id: "msg_completed",
        parentID: input.messageID,
        sessionID,
        role: "assistant",
        time: { created: 1700000001000, completed: 1700000002000 },
        modelID: "sonnet-fixture",
        providerID: "muc",
        agent: "build",
        mode: "build",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [{ id: "prt_complete", sessionID, messageID: "msg_completed", type: "text", text: "已按所选技能完成。" }],
    },
  ]
}

async function skills(page: Page, available: () => (typeof skill)[]) {
  const selections: Selection[] = []
  await page.route("**/api/skill/available*", (route) => route.fulfill({ json: { data: available() } }))
  await page.route("**/api/skill/translate*", (route) =>
    route.fulfill({ json: { data: { name: "任务研究技能", description: "整理资料" } } }),
  )
  await page.route("**/api/skill/selection*", (route) => {
    const input = route.request().postDataJSON() as Selection
    selections.push(input)
    return route.fulfill({ json: { data: input.skills.length ? [reference] : [] } })
  })
  return selections
}

async function send(page: Page, text: string) {
  await page.locator('[data-component="prompt-input"]').fill(text)
  await page.locator('[data-action="prompt-submit"]').click()
}

test("submitted task retains pinned skills after reload and next turn, while explicit removal survives another reload", async ({
  page,
}) => {
  const history: unknown[] = []
  const fixture = await setupCampusSession(page, { pageMessages: () => ({ items: history }) })
  let installed = true
  const selections = await skills(page, () => (installed ? [skill] : []))
  await page.goto("/new-session?draftId=" + campusFixture.draftID)
  await page.locator('[data-action="prompt-attach"]').click()
  await page.getByRole("menuitem", { name: "添加技能", exact: true }).click()
  await page
    .getByTestId("skill-selector")
    .getByRole("checkbox", { name: /任务研究技能/ })
    .click()
  await page.keyboard.press("Escape")
  await send(page, "第一轮任务")
  await expect.poll(() => fixture.submitted.length).toBe(1)
  const first = fixture.submitted[0] as Submitted
  expect(first.selectedSkills).toEqual([reference])
  await expect(page.getByTestId("selected-skills")).toContainText("任务研究技能")
  history.push(...conversation(first))
  installed = false
  await page.reload()
  await expect(page.getByText("已按所选技能完成。", { exact: true })).toBeVisible()
  await expect(page.getByTestId("selected-skills")).toContainText("任务研究技能")
  await send(page, "继续第二轮")
  await expect.poll(() => fixture.submitted.length).toBe(2)
  const second = fixture.submitted[1] as Submitted
  expect(second.selectedSkills).toEqual([reference])
  expect(selections[1]).toMatchObject({
    restoreFrom: first.messageID,
    skills: [{ id: skill.id, revision: skill.revision }],
  })
  history.splice(0, history.length, ...conversation(second))
  await page.reload()
  await expect(page.getByTestId("selected-skills")).toContainText("任务研究技能")
  await page.getByTestId("selected-skills").getByRole("button", { name: "任务研究技能", exact: true }).click()
  await expect(page.getByTestId("selected-skills")).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async (sessionID) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open("opencode-drafts")
          open.onsuccess = () => resolve(open.result)
          open.onerror = () => reject(open.error)
        })
        const request = db.transaction("documents").objectStore("documents").openCursor()
        const value = await new Promise<boolean>((resolve, reject) => {
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) return resolve(false)
            if (!String(cursor.key).includes("session:" + sessionID + ":prompt")) return cursor.continue()
            const doc = JSON.parse(cursor.value)
            resolve(Array.isArray(doc.skills) && doc.skills.length === 0 && doc.skillOrigin === undefined)
          }
        })
        db.close()
        return value
      }, campusFixture.sessionID),
    )
    .toBe(true)
  await page.reload()
  await expect(page.getByText("已按所选技能完成。", { exact: true })).toBeVisible()
  await expect(page.getByTestId("selected-skills")).toHaveCount(0)
  await send(page, "第三轮不使用技能")
  await expect.poll(() => fixture.submitted.length).toBe(3)
  expect((fixture.submitted[2] as Submitted).selectedSkills).toEqual([])
  expect(selections[2].skills).toEqual([])
  expect(selections[2].restoreFrom).toBeUndefined()
})

test("an existing task without local selection state restores its last submitted immutable references", async ({
  page,
}) => {
  const previous: Submitted = {
    messageID: "msg_previous",
    selectedSkills: [reference],
    parts: [{ type: "text", text: "已提交任务" }],
  }
  const fixture = await setupCampusSession(page, { pageMessages: () => ({ items: conversation(previous) }) })
  fixture.sessions.push(fixture.session)
  const selections = await skills(page, () => [])
  await page.goto("/projects")
  await page.getByRole("button", { name: /^Lake preview session/ }).click()
  await expect(page.getByText("已按所选技能完成。", { exact: true })).toBeVisible()
  await expect(page.getByTestId("selected-skills")).toBeVisible()
  await send(page, "恢复原任务")
  await expect.poll(() => fixture.submitted.length).toBe(1)
  expect((fixture.submitted[0] as Submitted).selectedSkills).toEqual([reference])
  expect(selections[0]).toMatchObject({
    restoreFrom: previous.messageID,
    skills: [{ id: skill.id, revision: skill.revision }],
  })
})
