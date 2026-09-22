import type { Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

export const campusFixture = {
  directory: "C:/OpenCode/campus-lake-demo",
  draftID: "draft_campus_lake",
  sessionID: "ses_campus_lake_created",
  projectID: "proj_campus_lake",
  video:
    "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_124724_bc041163-d651-425f-aea3-2acc1efc2c96.mp4",
}

export async function setupCampusSession(
  page: Page,
  options: { video?: "live" | "fail"; locale?: string; projectName?: string } = {},
) {
  const { directory, draftID, projectID, sessionID } = campusFixture
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "localhost"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4196"}`
  const submitted: unknown[] = []
  const session = {
    id: sessionID,
    slug: "campus-lake-created",
    projectID,
    directory,
    title: "Lake preview session",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
  const sessions: (typeof session)[] = []

  // Block every external request except the exact requested background asset.
  // All model and session endpoints below are local fixtures, never real providers.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue()
    if (options.video === "live" && url.href === campusFixture.video) return route.continue()
    return route.abort()
  })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: options.projectName ?? "campus-lake-demo",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "muc",
          name: "Campus fixture",
          models: {
            "sonnet-fixture": {
              id: "sonnet-fixture",
              name: "Sonnet 4.5",
              attachment: true,
              limit: { context: 200000, output: 8192 },
              cost: { input: 1, output: 1 },
              modalities: { input: ["text", "image"], output: ["text"] },
              variants: { high: {}, low: {} },
            },
            "second-fixture": {
              id: "second-fixture",
              name: "Campus test model",
              attachment: true,
              limit: { context: 200000, output: 8192 },
              cost: { input: 1, output: 1 },
            },
          },
        },
      ],
      connected: ["muc"],
      default: { muc: "sonnet-fixture" },
    },
    sessions,
    pageMessages: () => ({ items: [] }),
  })
  await page.route(
    (url) => url.origin === server && url.pathname === "/session",
    (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      sessions.push(session)
      return route.fulfill({ json: session, headers: { "access-control-allow-origin": "*" } })
    },
  )
  await page.route(
    (url) => url.origin === server && url.pathname === `/session/${sessionID}/prompt_async`,
    (route) => {
      if (route.request().method() === "POST") submitted.push(route.request().postDataJSON())
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    },
  )
  await page.addInitScript(
    ({ directory, draftID, server, locale }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayTabsToast: false } }),
      )
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale }))
      localStorage.setItem("opencode.settings.dat:defaultServerUrl", JSON.stringify(server))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server, locale: options.locale ?? "zh" },
  )
  return { submitted, session }
}
