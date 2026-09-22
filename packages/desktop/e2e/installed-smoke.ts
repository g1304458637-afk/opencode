import { _electron, expect } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { campusConfig } from "../scripts/campus-config"

// This deliberately installs the distributable, rather than launching unpacked output.
// Run only on disposable CI runners; local lifecycle tests use explicit isolated copies.
if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Requires disposable GitHub Actions runner")
const { brand, version } = campusConfig()
const output = resolve(process.env.CAMPUS_BUILD_OUTPUT || "dist")
const manifest = JSON.parse(readFileSync(join(output, "package-smoke.json"), "utf8"))
const root = mkdtempSync(join(tmpdir(), "campus-installed-"))
const installed = join(root, "Applications")
mkdirSync(installed)
const mac = process.platform === "darwin"
const artifact = manifest.artifacts.find((entry: { file: string }) => entry.file.endsWith(mac ? ".dmg" : ".exe"))
if (!artifact) throw new Error("Missing installer")
const binary = mac
  ? join(installed, `${brand.appName}.app`, "Contents", "MacOS", brand.appName)
  : join(installed, `${brand.appName}.exe`)

if (mac) {
  const mount = join(root, "mount")
  mkdirSync(mount)
  execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, join(output, artifact.file)])
  try {
    execFileSync("ditto", [join(mount, `${brand.appName}.app`), join(installed, `${brand.appName}.app`)])
  } finally {
    execFileSync("hdiutil", ["detach", mount])
  }
  const id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(installed, `${brand.appName}.app`, "Contents", "Info.plist")], { encoding: "utf8" }).trim()
  expect(id).toBe(brand.appId)
} else {
  execFileSync(join(output, artifact.file), ["/S", `/D=${installed}`], { timeout: 120_000 })
  // Read the installed shortcut's AppUserModelID, not merely the build config.
  const script = join(root, "identity.ps1")
  writeFileSync(script, `$ErrorActionPreference = 'Stop'
$links = @('Desktop', 'StartMenu', 'CommonDesktopDirectory', 'CommonStartMenu') |
  ForEach-Object { [Environment]::GetFolderPath($_) } |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
  Select-Object -Unique
$wsh = New-Object -ComObject WScript.Shell
$shell = New-Object -ComObject Shell.Application
$result = @(foreach ($link in Get-ChildItem $links -Filter *.lnk -Recurse) {
  $folder = $shell.NameSpace($link.DirectoryName)
  [PSCustomObject]@{
    path = $link.FullName
    target = $wsh.CreateShortcut($link.FullName).TargetPath
    appId = $folder.ParseName($link.Name).ExtendedProperty('System.AppUserModel.ID')
  }
})
ConvertTo-Json -InputObject $result -Compress
`)
  const links: { path: string; target: string; appId: string }[] = JSON.parse(
    execFileSync("powershell.exe", ["-NoProfile", "-File", script], { encoding: "utf8" }).trim(),
  )
  writeFileSync(join(output, "installed-shortcuts.json"), JSON.stringify({ binary, links }, null, 2))
  // Windows TEMP may use RUNNER~1 while Shell shortcuts expand it to runneradmin.
  // Compare the actual filesystem paths before asserting the native installed identity.
  const target = realpathSync.native(binary).toLowerCase()
  const shortcut = links.find((link) => existsSync(link.target) && realpathSync.native(link.target).toLowerCase() === target)
  expect(shortcut, "Installed application shortcut must target the installed binary").toBeDefined()
  const id = shortcut?.appId
  expect(id).toBe(brand.appId)
}

const app = await _electron.launch({
  executablePath: binary,
  env: { ...process.env, OPENCODE_TEST_ONBOARDING: "1", OPENCODE_TEST_ONBOARDING_ID: `ci-${brand.id}`, OPENCODE_SIDECAR_V2: "1" },
  timeout: 90_000,
}).catch((error) => {
  const logs = join(tmpdir(), `opencode-onboarding-ci-${brand.id}`, "desktop", "logs")
  if (existsSync(logs)) cpSync(logs, join(output, "installed-startup-logs"), { recursive: true })
  throw error
})
try {
  const page = await app.firstWindow({ timeout: 90_000 })
  await page.waitForFunction(() => Boolean(window.api?.mucGetState))
  const identity = await app.evaluate(({ app }) => ({
    name: app.getName(), version: app.getVersion(), architecture: process.arch, packaged: app.isPackaged, profile: app.getPath("userData"),
    metadata: JSON.parse(process.getBuiltinModule("fs").readFileSync(process.getBuiltinModule("path").join(app.getAppPath(), "package.json"), "utf8")).campusBuild,
  }))
  expect(identity.packaged).toBe(true)
  expect(identity.name).toBe(brand.appName)
  expect(identity.version).toBe(version)
  expect(manifest.target).toBe(`${mac ? "mac" : "win"}-${identity.architecture}`)
  expect(identity.profile).toContain(`opencode-onboarding-ci-${brand.id}`)
  expect(identity.metadata.sourceSha).toBe(manifest.sourceSha)
  expect(identity.metadata.brand).toBe(brand.id)
  expect(identity.metadata.gateway).toBe(brand.gatewayURL)
  expect(await page.evaluate(() => window.api.mucGetBrand())).toMatchObject({ id: brand.id, protocol: brand.protocolScheme })
  expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
  await page.screenshot({ path: join(output, "installed-smoke.png") })
  writeFileSync(join(output, "installed-smoke.json"), JSON.stringify({ verdict: "PASS", target: manifest.target, appId: brand.appId, installer: artifact.file, identity }, null, 2))
} finally {
  await app.close()
}
