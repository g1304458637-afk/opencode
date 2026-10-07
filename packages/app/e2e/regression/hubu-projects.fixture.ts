import type { Page } from "@playwright/test"
import { campusFixture, setupCampusSession } from "./hubu-features-base.fixture"

export async function setupHubuProjectChat(page: Page, options: { protocol?: "v1" | "v2" } = {}) {
  const sessionID = campusFixture.sessionID
  const directory = campusFixture.directory
  const now = Date.UTC(2026, 9, 4, 6, 22)
  const userID = "msg_hubu_user"
  const assistantID = "msg_hubu_assistant"
  const messages = [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: now },
        agent: "build",
        model: { providerID: "muc", modelID: "sonnet-fixture" },
      },
      parts: [
        {
          id: "prt_hubu_user",
          sessionID,
          messageID: userID,
          type: "text",
          text: "帮我把首页的视觉效果调整一下，保持简洁现代。改完后在本地预览一下。",
        },
      ],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        parentID: userID,
        time: { created: now + 1000, completed: now + 10000 },
        modelID: "sonnet-fixture",
        providerID: "muc",
        agent: "build",
        mode: "build",
        path: { cwd: directory, root: directory },
        cost: 0,
        tokens: { input: 100, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
      parts: [
        {
          id: "prt_hubu_reply",
          sessionID,
          messageID: assistantID,
          type: "text",
          text: "我会先检查页面结构，再调整视觉样式。\n\n这段会话位于中国经济档案项目中，你可以在左侧切换到同一项目的其他会话。",
        },
        {
          id: "prt_hubu_tool",
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: "call_hubu_read",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "index.html" },
            output: "<main>中国经济档案</main>",
            title: "index.html",
            metadata: {},
            time: { start: now + 2000, end: now + 3000 },
          },
        },
        {
          id: "prt_hubu_reply_end",
          sessionID,
          messageID: assistantID,
          type: "text",
          text: "页面结构已读取。接下来可以继续修改，或另开一个会话讨论资料整理。",
        },
      ],
    },
  ]
  const fixture = await setupCampusSession(page, {
    protocol: options.protocol,
    projectName: "中国经济档案",
    pageMessages: (id) => ({ items: id === sessionID ? messages : [] }),
  })
  fixture.session.title = "网页制作与本地预览"
  fixture.sessions.push(
    { ...fixture.session, time: { created: now, updated: now + 10000 } },
    {
      ...fixture.session,
      id: "ses_hubu_history",
      title: "史料整理",
      time: { created: now - 1000, updated: now - 1000 },
    },
    {
      ...fixture.session,
      id: "ses_hubu_map",
      title: "地图视觉优化",
      time: { created: now - 2000, updated: now - 2000 },
    },
    {
      ...fixture.session,
      id: "ses_hubu_product",
      title: "产品迭代",
      directory: "C:/OpenCode/HUBU",
      projectID: "proj_hubu",
    },
    {
      ...fixture.session,
      id: "ses_hubu_campus",
      title: "校园应用",
      directory: "C:/OpenCode/校园AI",
      projectID: "proj_campus",
    },
    {
      ...fixture.session,
      id: "ses_hubu_independent",
      title: "灵感随记",
      directory: "C:/OpenCode/Default Project",
      projectID: "global",
    },
  )
  const projectList = [
    { id: campusFixture.projectID, worktree: directory, name: "中国经济档案" },
    { id: "proj_hubu", worktree: "C:/OpenCode/HUBU", name: "HUBU" },
    { id: "proj_campus", worktree: "C:/OpenCode/校园AI", name: "校园AI" },
  ].map((project) => ({ ...project, vcs: "git", sandboxes: [], time: { created: now, updated: now } }))
  await page.route(
    (url) => url.pathname === "/project" || url.pathname === "/project/current" || url.pathname === "/path",
    (route) => {
      const url = new URL(route.request().url())
      const requested =
        url.searchParams.get("directory") ??
        decodeURIComponent(route.request().headers()["x-opencode-directory"] ?? directory)
      const project = projectList.find((p) => p.worktree === requested) ?? projectList[0]
      const json =
        url.pathname === "/project"
          ? projectList
          : url.pathname === "/project/current"
            ? project
            : {
                state: requested,
                config: requested,
                worktree: project.worktree,
                directory: requested,
                home: "C:/OpenCode",
              }
      return route.fulfill({ json, headers: { "access-control-allow-origin": "*" } })
    },
  )
  const deletions: { id: string; directory: string | null }[] = []
  const failures: Record<string, number> = {}
  const running = new Set<string>()
  const control: { beforeDelete?: () => Promise<void> } = {}
  await page.route(
    (url) => url.pathname === "/session/status" || url.pathname === "/api/session/active",
    (route) => {
      const current = new URL(route.request().url()).pathname.startsWith("/api/")
      const data = Object.fromEntries([...running].map((id) => [id, { type: current ? "running" : "busy" }]))
      return route.fulfill({ json: current ? { data } : data, headers: { "access-control-allow-origin": "*" } })
    },
  )
  await page.route(
    (url) => /^\/(?:api\/)?session\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback()
      const url = new URL(route.request().url())
      const id = url.pathname.split("/").at(-1)!
      deletions.push({
        id,
        directory:
          url.searchParams.get("directory") ??
          decodeURIComponent(route.request().headers()["x-opencode-directory"] ?? ""),
      })
      await control.beforeDelete?.()
      if (failures[id]) {
        failures[id]--
        return route.fulfill({
          status: 500,
          json: { error: "fixture deletion failed" },
          headers: { "access-control-allow-origin": "*" },
        })
      }
      const removed = new Set([id])
      for (;;) {
        const size = removed.size
        for (const session of fixture.sessions)
          if (session.parentID && removed.has(session.parentID)) removed.add(session.id)
        if (removed.size === size) break
      }
      for (let i = fixture.sessions.length - 1; i >= 0; i--)
        if (removed.has(fixture.sessions[i].id)) fixture.sessions.splice(i, 1)
      if (url.pathname.startsWith("/api/"))
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
      return route.fulfill({ json: true, headers: { "access-control-allow-origin": "*" } })
    },
  )
  return { ...fixture, messages, deletions, failures, running, control }
}
