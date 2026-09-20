#!/usr/bin/env bun
// MUC Harness: 版本注入一致性 + 构建不可变异（tracked source）自动测试。
//
//   bun test scripts/muc-version.test.ts
//
// 一致性链：release.json == Info.plist == asar package.json == latest*.yml == 产物文件名
// 不可变异：跑一遍 prebuild 前后 `git status --porcelain` 必须完全一致
// （prebuild 不得修改任何 git tracked 源文件；构建产物均被 gitignore）。
//
// 产物相关用例在 dist/ 缺失时自动跳过（CI 在 build 步骤之后运行即可全量生效）。

import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, expect } from "bun:test"
import { getMucVersion, MUC_VERSION_SOURCE } from "./utils"

const DESKTOP_DIR = import.meta.dir.replace(/\/scripts$/, "")
const DIST = `${DESKTOP_DIR}/dist`
const REPO_ROOT = `${DESKTOP_DIR}/../..`

const macAppCandidates = [`${DIST}/mac-arm64/mucode.app`, `${DIST}/mac/mucode.app`]

function findMacApp(): string | null {
  for (const dir of macAppCandidates) {
    if (existsSync(`${dir}/Contents/Info.plist`)) return dir
  }
  return null
}

function plistValue(app: string, key: string): string {
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print ${key}`, `${app}/Contents/Info.plist`], {
    encoding: "utf8",
  }).trim()
}

function ymlVersion(path: string): string {
  const match = readFileSync(path, "utf8").match(/^version:\s*['"]?([^'"\n]+)['"]?/m)
  if (!match) throw new Error(`${path}: no version field`)
  return match[1]
}

/** 从 asar 中提取 package.json 并解析（@electron/asar 来自 bun 隔离 store） */
function asarPackageVersion(asarPath: string): string {
  let asar: { extractFile: (archive: string, file: string) => Buffer }
  try {
    // @ts-expect-error 可选依赖，缺失时回退隔离 store 路径
    asar = require("@electron/asar")
  } catch {
    const store = join(REPO_ROOT, "node_modules/.bun")
    const entry = execFileSync(
      "bash",
      ["-c", `ls -d ${store}/@electron+asar@*/node_modules/@electron/asar 2>/dev/null | head -1`],
      { encoding: "utf8" },
    ).trim()
    if (!entry) throw new Error("@electron/asar not available")
    asar = require(entry)
  }
  return JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8")).version
}

test("release.json has valid semver version (MUC_VERSION_SOURCE)", async () => {
  const version = await getMucVersion()
  expect(version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
  expect(version === "1.18.31").toBe(false) // 不得再与上游 OpenCode 版本耦合
})

test("prebuild does not mutate any git-tracked source file", async () => {
  const before = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" })
  execFileSync("bun", ["scripts/prebuild.ts"], {
    cwd: DESKTOP_DIR,
    env: { ...process.env, OPENCODE_CHANNEL: "muc" },
    stdio: "pipe",
  })
  const after = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" })
  expect(after).toEqual(before)
}, 420_000)

const macApp = findMacApp()
const hasMacArtifacts = macApp !== null
const hasWinArtifacts = existsSync(`${DIST}/win-unpacked/resources/app-update.yml`)
const hasMacYml = existsSync(`${DIST}/latest-mac.yml`)
const hasWinYml = existsSync(`${DIST}/latest.yml`)

test.skipIf(!hasMacArtifacts)("Info.plist CFBundleShortVersionString == release.json", async () => {
  const version = await getMucVersion()
  expect(plistValue(macApp!, "CFBundleShortVersionString")).toBe(version)
  expect(plistValue(macApp!, "CFBundleVersion")).toBe(version)
})

test.skipIf(!hasMacArtifacts)("packaged asar package.json version == release.json", async () => {
  const version = await getMucVersion()
  const tmp = mkdtempSync(join(tmpdir(), "muc-asar-test-"))
  try {
    expect(asarPackageVersion(`${macApp!}/Contents/Resources/app.asar`)).toBe(version)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test.skipIf(!hasMacArtifacts)("app-update.yml (mac) points at muc-updates <os>/<arch> generic feed", () => {
  const raw = readFileSync(`${macApp!}/Contents/Resources/app-update.yml`, "utf8")
  expect(raw).toContain("provider: generic")
  expect(raw).toMatch(/muc-updates\/stable\/(mac|darwin)\/(arm64|x64)/)
  expect(raw).not.toContain("${") // 宏必须已在打包期展开
})

test.skipIf(!hasWinArtifacts)("app-update.yml (win) points at muc-updates win feed", () => {
  const raw = readFileSync(`${DIST}/win-unpacked/resources/app-update.yml`, "utf8")
  expect(raw).toContain("provider: generic")
  expect(raw).toMatch(/muc-updates\/stable\/win\/x64/)
  expect(raw).not.toContain("${")
})

test.skipIf(!hasMacYml)("latest-mac.yml version == release.json and references versioned payload", async () => {
  const version = await getMucVersion()
  expect(ymlVersion(`${DIST}/latest-mac.yml`)).toBe(version)
  expect(readFileSync(`${DIST}/latest-mac.yml`, "utf8")).toContain(`mucode-${version}-mac-`)
  expect(existsSync(`${DIST}/mucode-${version}-mac-arm64.zip`)).toBeTrue()
})

test.skipIf(!hasWinYml)("latest.yml version == release.json and references versioned payload", async () => {
  const version = await getMucVersion()
  expect(ymlVersion(`${DIST}/latest.yml`)).toBe(version)
  expect(readFileSync(`${DIST}/latest.yml`, "utf8")).toContain(`mucode-${version}-win-x64.exe`)
})

test.skipIf(!hasMacYml && !hasWinYml)("dist installers are all version-named (feed hygiene)", async () => {
  const version = await getMucVersion()
  const files = execFileSync("ls", [DIST], { encoding: "utf8" }).split("\n").filter(Boolean)
  for (const file of files) {
    if (/\.(zip|exe|dmg)$/.test(file)) {
      expect(file).toContain(`mucode-${version}`)
    }
  }
})
