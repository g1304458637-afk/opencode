import { _electron, expect } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Test a disposable copy from the DMG without replacing an installed app or
// accessing the user's desktop profile. Normal packaged startup stays intact.
const output = resolve(process.env.CAMPUS_BUILD_OUTPUT || "dist/cinematic-hubu")
const manifest = JSON.parse(readFileSync(join(output, "package-smoke.json"), "utf8"))
const installer = manifest.artifacts.find((item: { file: string }) => item.file.endsWith(".dmg"))
if (!installer || process.platform !== "darwin") throw new Error("Requires the macOS DMG")
const root = mkdtempSync(join(tmpdir(), "cinematic-package-"))
const mount = join(root, "mount")
mkdirSync(mount)
execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, join(output, installer.file)])
try {
  execFileSync("ditto", [join(mount, "HUBU AI.app"), join(root, "HUBU AI.app")])
} finally {
  execFileSync("hdiutil", ["detach", mount])
}
const app = await _electron.launch({
  executablePath: join(root, "HUBU AI.app/Contents/MacOS/HUBU AI"),
  env: {
    ...process.env,
    OPENCODE_TEST_ONBOARDING: "1",
    OPENCODE_TEST_ONBOARDING_ID: `cinematic-${Date.now()}`,
    OPENCODE_SIDECAR_V2: "1",
  },
  timeout: 90_000,
})
try {
  const page = await app.firstWindow({ timeout: 90_000 })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.api?.mucGetState))
  const identity = await app.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    profile: app.getPath("userData"),
  }))
  expect(identity).toMatchObject({ name: "HUBU AI", version: manifest.version, packaged: true })
  expect(identity.profile).toContain("opencode-onboarding-cinematic-")
  expect(await page.evaluate(() => window.api.mucGetBrand())).toMatchObject({ id: "hubu" })
  expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
  await page.screenshot({ path: join(output, "packaged-startup.png") })
  writeFileSync(join(output, "packaged-startup.txt"), await page.locator("body").innerText())
  // A fresh real installer must retain the campus authorization gate. The
  // authenticated workspace/material assertion is exercised by campus.ts.
  await expect(page.getByText("尚未连接账户", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "从网站连接 HUBU", exact: true })).toBeVisible()
  await page.screenshot({ path: join(output, "packaged-launch.png") })
  expect(errors).toEqual([])
  writeFileSync(
    join(output, "packaged-launch.json"),
    JSON.stringify({ verdict: "PASS", installer: installer.file, isolatedCopy: root, identity, errors }, null, 2),
  )
} finally {
  await app.close()
}
