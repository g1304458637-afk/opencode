/**
 * Local-only preview of a production build using the same fixtures as the E2E tests.
 * bun e2e/regression/campus-preview.ts /tmp/campus-lake-build-muc 4470
 * No real model, credentials, or project filesystem are accessed.
 */
import { resolve } from "node:path"
import type { Page, Route } from "@playwright/test"
import { campusFixture, setupCampusSession } from "./campus-new-session.fixture"

const directory = resolve(process.argv[2] ?? "dist")
const port = Number(process.argv[3] ?? 4470)
const origin = `http://127.0.0.1:${port}`
process.env.PLAYWRIGHT_SERVER_HOST = "127.0.0.1"
process.env.PLAYWRIGHT_SERVER_PORT = String(port)
process.env.PLAYWRIGHT_PORT = String(port)
process.env.PLAYWRIGHT_BASE_URL = origin

const scripts: string[] = []
const routes: {
  match: string | ((url: URL) => boolean)
  handle: (route: Route) => unknown
}[] = []

// A small HTTP adapter for the Playwright fixture, not a second mock API implementation.
const fixturePage = {
  route(match: string | ((url: URL) => boolean), handle: (route: Route) => unknown) {
    routes.unshift({ match, handle })
  },
  addInitScript(script: (...args: never[]) => unknown, arg: unknown) {
    scripts.push(`(${script.toString()})(${JSON.stringify(arg)});`)
  },
} as unknown as Page

await setupCampusSession(fixturePage, { video: "live" })
const index = await Bun.file(resolve(directory, "index.html")).text()
const bootstrap = `<script>${scripts.join("\n")}</script>`

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/") return Response.redirect(`${origin}/new-session?draftId=${campusFixture.draftID}`, 302)
    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.text()
    let response: Response | undefined
    const staticFile = async () => {
      const path = resolve(directory, `.${decodeURIComponent(url.pathname)}`)
      if (!path.startsWith(`${directory}/`)) {
        response = new Response("Not found", { status: 404 })
        return
      }
      const file = Bun.file(path)
      if (await file.exists()) {
        response = new Response(file)
        return
      }
      response = new Response(index.replace("<head>", `<head>${bootstrap}`), {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    }
    const matches = routes.filter((route) =>
      typeof route.match === "function" ? route.match(url) : route.match === "**/*",
    )
    const dispatch = async (position: number): Promise<void> => {
      const entry = matches[position]
      if (!entry) return staticFile()
      await entry.handle({
        request: () => ({ url: () => request.url, method: () => request.method, postDataJSON: () => JSON.parse(body) }),
        fallback: () => dispatch(position + 1),
        continue: staticFile,
        abort: () => {
          response = new Response(null, { status: 503 })
        },
        fulfill: (value: {
          status?: number
          json?: unknown
          body?: string
          contentType?: string
          headers?: Record<string, string>
        }) => {
          response = new Response(value.json === undefined ? value.body : JSON.stringify(value.json), {
            status: value.status ?? 200,
            headers: {
              "content-type": value.contentType ?? (value.json === undefined ? "text/plain" : "application/json"),
              ...value.headers,
            },
          })
        },
      } as unknown as Route)
    }
    await dispatch(0)
    return response ?? new Response("Fixture did not respond", { status: 500 })
  },
})
console.log(`Campus fixture preview: ${origin}/new-session?draftId=${campusFixture.draftID}`)
