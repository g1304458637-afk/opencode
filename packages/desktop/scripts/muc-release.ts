#!/usr/bin/env bun
// MUC Harness: mucode 发布脚本（Phase 7/11 + Production Hardening）。
//
// 命令：
//   bun scripts/muc-release.ts version
//   bun scripts/muc-release.ts bump 2.0.1
//   bun scripts/muc-release.ts build mac-arm64|mac-x64|win-x64
//   bun scripts/muc-release.ts verify mac-arm64|mac-x64|win-x64
//   bun scripts/muc-release.ts upload [--execute] [--host admin@host] [--test-feed]
//
// 原子发布顺序（upload 子命令内建，顺序不可调换）：
//   0. 签名安全门（仅生产 stable；--test-feed 豁免）
//   1. 版本化 payload（zip/exe/blockmap）先上传
//   2. 远端 SHA256/大小逐字节校验
//   3. 最后上传 latest-mac.yml / latest.yml（manifest 最后出现）
//   4. （仅 stable）刷新 /downloads 人工下载别名 + SHA256SUMS.txt
//
// 签名安全门（#6）：生产 stable 上传前必须通过——
//   mac: codesign verify PASS + Authority=Developer ID Application + stapler validate PASS
//   win: 在 win32 上 signtool verify /pa PASS（mac 交叉构建无法验证 → 拒绝发布 stable）
// 任何一项不满足 → 直接失败，不产生任何上传/manifest 变更。
//
// 本脚本只发布 muc-main 已测试的本地构建产物；不触碰上游 OpenCode。

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"
import { getMucVersion, MUC_VERSION_SOURCE } from "./utils"

const DESKTOP_DIR = import.meta.dir.replace(/\/scripts$/, "")
const DIST = `${DESKTOP_DIR}/dist`
const DEFAULT_HOST = process.env.MUC_RELEASE_HOST ?? "admin@112.125.88.123"
const REMOTE_ROOT = "/srv/sub2api/data/downloads"
// MUC Harness: 发布模式。
// - manual-install（当前默认）：允许 unsigned 产物进 stable（UNSIGNED_MANUAL_RELEASE），
//   用户手动下载安装；签名门跳过。
// - auto-install（未来签名后）：stable 强制签名门（mac Developer ID+公证 / win Authenticode）。
const RELEASE_MODE = process.env.MUC_UPDATE_MODE === "auto-install" ? "auto-install" : "manual-install"

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** 目标平台的 node-pty 平台包（vite externalize 与 native 卫生过滤都以此为准） */
const PTY_PKG_BY_TARGET: Record<string, string> = {
  "mac-arm64": "@lydell/node-pty-darwin-arm64",
  "mac-x64": "@lydell/node-pty-darwin-x64",
  "win-x64": "@lydell/node-pty-win32-x64",
}

/**
 * 打包前物理裁剪与目标平台/架构不符的原生平台包（含唯一架构 .node）。
 * electron-builder 的 files 过滤不作用于自动收集的 node_modules（实测），
 * 因此以裁剪保证「错误架构平台包 = 0」；打包后用 bun install 恢复开发环境。
 */
const NATIVE_HYGIENE_FAMILIES: Array<{ scope: string; name: string; platforms: string[] }> = [
  {
    scope: "@lydell",
    name: "node-pty",
    platforms: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "linux-arm64-musl", "linux-x64-musl", "linux-arm64-glibc", "linux-x64-glibc", "win32-arm64", "win32-x64"],
  },
  {
    scope: "@parcel",
    name: "watcher",
    platforms: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "linux-arm64-musl", "linux-x64-musl", "linux-arm64-glibc", "linux-x64-glibc", "win32-arm64", "win32-x64"],
  },
  {
    scope: "@msgpackr-extract",
    name: "msgpackr-extract",
    platforms: ["darwin-arm64", "darwin-x64", "linux-arm", "linux-arm64", "linux-x64", "win32-x64"],
  },
]

async function pruneNativePackages(target: string) {
  const keepPkg = PTY_PKG_BY_TARGET[target]!
  const keepPlatform = keepPkg.replace("@lydell/node-pty-", "").split("-")[0]!
  const wrongPlatformArch = target === "mac-arm64" ? "darwin-x64" : target === "mac-x64" ? "darwin-arm64" : null
  const doomed: string[] = []
  for (const { scope, name, platforms } of NATIVE_HYGIENE_FAMILIES) {
    for (const platform of platforms) {
      if (platform === keepPlatform) continue
      if (platform === wrongPlatformArch || !platform.startsWith(keepPlatform)) {
        doomed.push(`node_modules/${scope}/${name}-${platform}`)
      }
    }
  }
  // rel 形如 "node_modules/<scope>/<pkg>-<platform>"，root 直接取到 node_modules 的上一级；
  // bun 隔离布局里 hoist 副本还存在于 node_modules/.bun/node_modules/（同样按 rel 定位）
  const roots = [`${DESKTOP_DIR}`, `${DESKTOP_DIR}/../..`, `${DESKTOP_DIR}/../../node_modules/.bun`]
  let pruned = 0
  for (const root of roots) {
    for (const rel of doomed) {
      const full = `${root}/${rel}`
      if (existsSync(full)) {
        await $`rm -rf ${full}`
        pruned++
      }
    }
  }
  console.log(`pruned ${pruned} non-target native platform package dirs（keep ${keepPkg}）`)
  restorePending.value = true
}

/** bun 在 mac 上不安装 win32/linux 平台包——win 目标需显式拉取 win32-x64 平台包进 node_modules，
 * 供 electron-builder 收集（与 downloadCliToResources 同一隔离安装模式）。 */
async function ensureWinPtyPackage() {
  const pkgJson = JSON.parse(readFileSync(`${DESKTOP_DIR}/package.json`, "utf8"))
  const version = pkgJson.optionalDependencies?.["@lydell/node-pty-win32-x64"]
  if (!version) throw new Error("desktop package.json: @lydell/node-pty-win32-x64 optionalDependency not found")
  const dest = `${DESKTOP_DIR}/node_modules/@lydell/node-pty-win32-x64`
  if (existsSync(`${dest}/prebuilds/win32-x64/conpty.node`)) return
  const tmp = Bun.spawnSync(["mktemp", "-d", "/tmp/muc-winpty-XXXXXX"]).stdout.toString().trim()
  await sh(["bun", "install", "--no-save", "--cwd", tmp, `@lydell/node-pty-win32-x64@${version}`, "--os=win32", "--cpu=x64"])
  await sh(["cp", "-R", `${tmp}/node_modules/@lydell/node-pty-win32-x64`, dest])
  await sh(["rm", "-rf", tmp])
  console.log(`fetched @lydell/node-pty-win32-x64@${version} into node_modules`)
}

/** restore 后校验本机（构建机）原生依赖确实可用：arm64 binding + watcher binding */
function verifyRestore() {
  const binding = `${DESKTOP_DIR}/node_modules/@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/pty.node`
  if (!existsSync(binding)) {
    throw new Error(`restore verify FAIL: 本机 node-pty binding 缺失（${binding}）`)
  }
  if (!existsSync(`${DESKTOP_DIR}/node_modules/@parcel/watcher-darwin-arm64/watcher.node`)) {
    throw new Error("restore verify FAIL: 本机 parcel watcher binding 缺失")
  }
}

async function restoreNativePackages() {
  console.log("restoring node_modules (bun install --frozen-lockfile)…")
  const proc = Bun.spawn(["bun", "install", "--force", "--frozen-lockfile"], {
    cwd: `${DESKTOP_DIR}/../..`,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await proc.exited) !== 0) throw new Error("bun install restore failed")
}

/** native 架构门：包内所有 .node 与主执行档必须匹配目标架构（universal 允许）。 */
function nativeArchGate(target: string, appPath: string) {
  const wantArch = target === "mac-arm64" ? "arm64" : target === "mac-x64" ? "x86_64" : "x86_64"
  const roots = [`${appPath}/Contents/Resources/app.asar.unpacked`, `${appPath}/Contents/Frameworks`]
  let checked = 0
  for (const root of roots) {
    if (!existsSync(root)) continue
    const nodes = Bun.spawnSync(["bash", "-c", `find ${JSON.stringify(root)} -name "*.node" -type f`], {
      stdout: "pipe",
    }).stdout.toString().split("\n").filter(Boolean)
    for (const node of nodes) {
      checked++
      const kind = Bun.spawnSync(["file", "-b", node], { stdout: "pipe" }).stdout.toString()
      if (kind.includes("Mach-O")) {
        const lipo = Bun.spawnSync(["lipo", "-info", node], { stdout: "pipe", stderr: "pipe" })
        const archs = lipo.stdout.toString()
        if (lipo.exitCode !== 0) {
          throw new Error(`NATIVE ARCH GATE: 无法判定 Mach-O 架构 ${node}: ${lipo.stderr.toString().slice(0, 200)}`)
        }
        // lipo 两种输出：fat → "Architectures: arm64 x86_64"；thin → "Non-fat file ... is architecture: arm64"
        const thin = archs.match(/is architecture: (\S+)\s*$/)?.[1]
        const pass = /Architectures:/.test(archs) ? archs.includes(wantArch) : thin === wantArch
        if (!pass) throw new Error(`NATIVE ARCH GATE FAIL: ${node} → ${archs.trim()}（期望 ${wantArch}）`)
      } else if (kind.includes("PE32+")) {
        if (wantArch !== "x86_64") throw new Error(`NATIVE ARCH GATE FAIL: PE32+ .node 出现在非 win 包：${node}`)
      } else {
        throw new Error(`NATIVE ARCH GATE: 未识别的二进制类型 ${node}: ${kind.slice(0, 120)}`)
      }
    }
  }
  const exeInfo = Bun.spawnSync(["file", "-b", `${appPath}/Contents/MacOS/mucode`], { stdout: "pipe" })
    .stdout.toString()
  if (!exeInfo.includes(wantArch)) {
    throw new Error(`NATIVE ARCH GATE FAIL: 主执行档架构错误 → ${exeInfo.trim()}（期望 ${wantArch}）`)
  }
  // 平台包卫生：目标平台不含错误的 darwin 架构包目录
  const wanted = PTY_PKG_BY_TARGET[target]
  const wrongDirs: string[] = []
  if (wanted.startsWith("@lydell/node-pty-darwin-")) {
    const wrong = wanted.endsWith("arm64") ? "darwin-x64" : "darwin-arm64"
    for (const root of roots) {
      const bad = `${root}/node_modules/@lydell/node-pty-${wrong}`
      if (existsSync(bad)) wrongDirs.push(bad)
    }
  }
  if (wrongDirs.length > 0) throw new Error(`NATIVE ARCH GATE FAIL: 错误架构平台包仍在包内：${wrongDirs.join(", ")}`)
  console.log(`native arch gate OK (${target}): ${checked} 个 .node + 主执行档全部匹配`)
}

async function sh(cmd: string[]) {
  console.log(`+ ${cmd.join(" ")}`)
  const proc = Bun.spawn(cmd, { cwd: DESKTOP_DIR, env: process.env, stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`command failed (${code}): ${cmd.join(" ")}`)
}

function parseYmlVersion(path: string): string {
  const raw = readFileSync(path, "utf8")
  const match = raw.match(/^version:\s*(\S+)/m)
  if (!match) throw new Error(`${path}: no version field`)
  return match[1].replace(/^['"]|['"]$/g, "")
}

async function verifyBuild(target: string, version: string) {
  const files: Array<{ file: string; sha256: string; bytes: number }> = []

  if (target === "mac-arm64" || target === "mac-x64") {
    const arch = target === "mac-arm64" ? "arm64" : "x64"
    // electron-builder 的 mac appOutDir 随默认架构规则变化（本机实测 arm64→dist/mac-arm64、x64→dist/mac）
    const appDir = [`${DIST}/mac-${arch}`, `${DIST}/mac`].find((dir) => existsSync(`${dir}/mucode.app`))
    if (!appDir) throw new Error(`mucode.app not found under dist/mac[-${arch}]`)
    const appPath = `${appDir}/mucode.app`
    const plist = `${appPath}/Contents/Info.plist`
    if (!existsSync(plist)) throw new Error(`missing ${plist}`)
    const bundled = Bun.spawnSync(["/usr/libexec/PlistBuddy", "-c", "Print CFBundleShortVersionString", plist], {
      stdout: "pipe",
    }).stdout.toString().trim()
    if (bundled !== version) throw new Error(`Info.plist version ${bundled} != release.json ${version}`)

    const updateYml = `${appPath}/Contents/Resources/app-update.yml`
    if (!existsSync(updateYml)) throw new Error(`missing ${updateYml} (publish config not applied?)`)
    if (!readFileSync(updateYml, "utf8").includes("muc-updates")) {
      throw new Error(`${updateYml}: feed url not pointing at muc-updates`)
    }

    const latestYml = `${DIST}/latest-mac.yml`
    if (!existsSync(latestYml)) throw new Error(`missing ${latestYml}`)
    if (parseYmlVersion(latestYml) !== version) throw new Error(`latest-mac.yml version != ${version}`)

    const zip = `${DIST}/mucode-${version}-mac-${arch}.zip`
    if (!existsSync(zip)) throw new Error(`missing update payload ${zip}`)
    nativeArchGate(target, appPath)
    files.push(
      { file: `mucode-${version}-mac-${arch}.zip`, sha256: sha256(zip), bytes: (await Bun.file(zip).size) },
      { file: `mucode-${version}-mac-${arch}.zip.blockmap`, sha256: sha256(`${zip}.blockmap`), bytes: (await Bun.file(`${zip}.blockmap`).size) },
      { file: `mucode-${version}-mac-${arch}.dmg`, sha256: sha256(`${DIST}/mucode-${version}-mac-${arch}.dmg`), bytes: (await Bun.file(`${DIST}/mucode-${version}-mac-${arch}.dmg`).size) },
    )
  } else {
    const unpacked = `${DIST}/win-unpacked/resources`
    const updateYml = `${unpacked}/app-update.yml`
    if (!existsSync(updateYml)) throw new Error(`missing ${updateYml} (publish config not applied?)`)
    if (!readFileSync(updateYml, "utf8").includes("muc-updates")) {
      throw new Error(`${updateYml}: feed url not pointing at muc-updates`)
    }
    const latestYml = `${DIST}/latest.yml`
    if (!existsSync(latestYml)) throw new Error(`missing ${latestYml}`)
    if (parseYmlVersion(latestYml) !== version) throw new Error(`latest.yml version != ${version}`)
    const exe = `${DIST}/mucode-${version}-win-x64.exe`
    if (!existsSync(exe)) throw new Error(`missing update payload ${exe}`)
    // win：darwin 平台包不得混入 + .node 全部为 PE（x64）
    const unpackedRoot = `${DIST}/win-unpacked/resources/app.asar.unpacked`
    if (existsSync(`${unpackedRoot}/node_modules/@lydell/node-pty-darwin-arm64`)) {
      throw new Error("NATIVE ARCH GATE FAIL: win 包内混入 node-pty-darwin-arm64")
    }
    const winPty = `${unpackedRoot}/node_modules/@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty.node`
    if (!existsSync(winPty)) throw new Error(`NATIVE ARCH GATE FAIL: win 包缺少 win32-x64 conpty.node（${winPty}）`)
    files.push(
      { file: `mucode-${version}-win-x64.exe`, sha256: sha256(exe), bytes: (await Bun.file(exe).size) },
      { file: `mucode-${version}-win-x64.exe.blockmap`, sha256: sha256(`${exe}.blockmap`), bytes: (await Bun.file(`${exe}.blockmap`).size) },
    )
  }

  const manifestPath = `${DIST}/muc-release-manifest.json`
  const manifest = {
    target,
    version,
    updateMode: RELEASE_MODE,
    generatedAt: new Date().toISOString(),
    files,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  console.log(`verify OK (${target} @ ${version}); manifest → ${manifestPath}`)
}

// ===== build 临界区异常安全（A）=====
// prune 会临时删除 node_modules 中的非目标平台包；package 失败/中断都必须恢复。
const restorePending = { value: false }

function buildLockPath(): string {
  const hash = createHash("sha256").update(DESKTOP_DIR).digest("hex").slice(0, 12)
  return join(tmpdir(), `muc-release-build-${hash}.lock`)
}

function acquireBuildLock() {
  const path = buildLockPath()
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" })
      return
    } catch {
      const raw = existsSync(path) ? readFileSync(path, "utf8").trim() : ""
      const pid = Number(raw)
      let alive = false
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          alive = true
        } catch (e) {
          alive = (e as NodeJS.ErrnoException).code === "EPERM"
        }
      }
      if (alive) {
        throw new Error(
          `BUILD_LOCK: 另一个 muc-release build 正在运行（pid ${pid}，lock=${path}）。` +
            `并发架构构建共享同一 node_modules，禁止同时 prune；请等待或先结束对方。`,
        )
      }
      // 陈旧锁（持有进程已死）→ 收走重试；极少数竞态下多试两次
      if (attempt < 2) {
        try {
          rmSync(path)
        } catch {}
        continue
      }
      throw new Error(`BUILD_LOCK: 无法获取 lock ${path}（陈旧且清理失败）`)
    }
  }
}

function releaseBuildLock() {
  try {
    rmSync(buildLockPath())
  } catch {}
}

/** SIGINT/SIGTERM 尽最大努力恢复被 prune 的 node_modules 并释放锁，再退出。 */
function installSignalGuard() {
  const handler = (sig: string) => {
    console.error(`\n${sig} received; best-effort recovery…`)
    if (restorePending.value) {
      try {
        console.error("restoring pruned native packages…")
        Bun.spawnSync(["bun", "install", "--force", "--frozen-lockfile"], {
          cwd: `${DESKTOP_DIR}/../..`,
          env: process.env,
          stdout: "ignore",
          stderr: "inherit",
        })
      } catch {}
    }
    releaseBuildLock()
    process.exit(128 + (sig === "SIGINT" ? 2 : 15))
  }
  process.on("SIGINT", () => handler("SIGINT"))
  process.on("SIGTERM", () => handler("SIGTERM"))
}

async function build(target: string) {
  const version = await getMucVersion()
  console.log(`MUC release: building ${target} @ ${version}`)
  process.env.OPENCODE_CHANNEL = "muc"
  // MUC Harness: node-pty 平台包跟随【打包目标】而非构建机（native 架构错配根因修复）
  process.env.MUC_PTY_PKG = PTY_PKG_BY_TARGET[target]!
  installSignalGuard()
  acquireBuildLock()
  // 测试钩子：模拟 package 阶段失败（prune 已发生、restore 未执行），用于验证
  // finally 恢复/信号恢复；跳过重型 build 以聚焦临界区。正常发布绝不设置。
  const forceFail = process.env.MUC_RELEASE_FORCE_FAIL === "1"
  try {
    if (!forceFail) {
      // 全量 build（含 prebuild：dist/node 重建）。版本只读注入：
      // 渲染层走 electron.vite MUC_VERSION define，打包走 extraMetadata.version，
      // 构建流程不修改任何 git tracked 源文件。
      await sh(["bun", "run", "build"])
    }
    if (target === "win-x64") await ensureWinPtyPackage()
    await pruneNativePackages(target)
    if (forceFail) {
      const delay = Number(process.env.MUC_RELEASE_FAIL_DELAY ?? "0")
      if (delay > 0) {
        console.log(`FORCE_FAIL: holding critical section for ${delay}s…`)
        await new Promise((r) => setTimeout(r, delay * 1000))
      }
      throw new Error("FORCE_FAIL: simulated packaging failure (MUC_RELEASE_FORCE_FAIL=1)")
    }
    const eb = ["npx", "electron-builder", "--config", "electron-builder.config.ts", "--publish", "never"]
    if (target === "mac-arm64") await sh([...eb, "--mac", "--arm64"])
    if (target === "mac-x64") await sh([...eb, "--mac", "--x64"])
    if (target === "win-x64") await sh([...eb, "--win", "--x64"])
  } finally {
    // 无论 package 成功/失败/中断，都必须把开发环境 node_modules 恢复原状
    await restoreNativePackages().finally(() => {
      restorePending.value = false
      releaseBuildLock()
    })
  }
  await verifyBuild(target, version)
}

function findMacApp(): string {
  const dir = [`${DIST}/mac-arm64`, `${DIST}/mac`].find((d) => existsSync(`${d}/mucode.app/Contents/Info.plist`))
  if (!dir) throw new Error("mucode.app not found under dist/mac[-arm64]")
  return `${dir}/mucode.app`
}

function runCapture(cmd: string[]): { code: number; out: string } {
  const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" })
  return { code: proc.exitCode ?? 1, out: proc.stdout.toString() + proc.stderr.toString() }
}

const sha512 = (path: string) => createHash("sha512").update(readFileSync(path)).digest("base64")

/** 解析 latest*.yml 的 version + files[]（url/size/sha512），用于 manifest 引用完整性校验 */
function parseChannelManifest(path: string) {
  const raw = readFileSync(path, "utf8")
  const version = raw.match(/^version:\s*['"]?([^'"\n]+)['"]?/m)?.[1]
  if (!version) throw new Error(`${path}: no version field`)
  const files = [...raw.matchAll(/- url: (\S+)\n\s+sha512: (\S+)\n\s+size: (\d+)/g)].map((m) => ({
    url: m[1]!,
    sha512: m[2]!,
    size: Number(m[3]),
  }))
  if (files.length === 0) throw new Error(`${path}: no files[] parsed`)
  return { version, files, path }
}

/** #8 manifest 引用完整性：本地逐一核对 url/size/sha512；不一致 → DO_NOT_PUBLISH_MANIFEST */
function verifyLocalManifest(manifestPath: string) {
  const cm = parseChannelManifest(manifestPath)
  for (const f of cm.files) {
    const local = `${DIST}/${f.url}`
    if (!existsSync(local)) throw new Error(`DO_NOT_PUBLISH_MANIFEST: ${f.url} referenced by ${manifestPath} missing locally`)
    const size = Bun.file(local).size
    const hash = sha512(local)
    if (size !== f.size) throw new Error(`DO_NOT_PUBLISH_MANIFEST: ${f.url} size ${size} != manifest ${f.size}`)
    if (hash !== f.sha512) throw new Error(`DO_NOT_PUBLISH_MANIFEST: ${f.url} sha512 mismatch`)
  }
  console.log(`local manifest integrity OK: ${manifestPath} (${cm.files.length} files @ ${cm.version})`)
}

/** #7 同版本重复发布保护：stable 中该版本的 channel manifest 已存在 → 硬拒（immutable releases）。
 *  payload 残缺（无 manifest）视为未发布，允许断点续传补齐。 */
async function ensureVersionNotPublished(host: string, remoteDir: string, manifestFile: string, version: string) {
  const probe = Bun.spawnSync(
    ["ssh", host, `if [ -e '${remoteDir}/${manifestFile}' ]; then echo YES_ALREADY_PUBLISHED; else echo NO_NOT_PUBLISHED; fi`],
    { stdout: "pipe", stderr: "pipe" },
  )
  if (probe.stdout.toString().includes("YES_ALREADY_PUBLISHED")) {
    throw new Error(
      `IMMUTABLE_RELEASE: ${version} 的 ${manifestFile} 已发布至 stable，禁止覆盖重发。\n` +
        `请 bump 新版本（如 2.0.5）后重新 build + upload。`,
    )
  }
  console.log(`version-not-published probe OK（stable 无 ${version} 的 ${manifestFile}）`)
}

/** #6 签名安全门（macOS）：ad-hoc / 未公证 → 直接失败，错误信息指明缺失的凭据类别。 */
function gateMac() {
  const app = findMacApp()
  const steps: Array<[string, string, () => { code: number; out: string }]> = [
    [
      "codesign --verify --deep --strict",
      "应用签名无效（codesign verify 失败）",
      () => runCapture(["codesign", "--verify", "--deep", "--strict", app]),
    ],
    [
      "Developer ID Application identity",
      "缺少 Developer ID Application 证书（当前为 ad-hoc 或无 identity）——WAITING_FOR_APPLE_SIGNING_CREDENTIAL",
      () => {
        const r = runCapture(["codesign", "-dv", app])
        return { code: r.out.includes("Authority=Developer ID Application") ? 0 : 1, out: r.out }
      },
    ],
    [
      "notarization stapling",
      "缺少 notarization/staple（公证凭据未配置或未公证）——WAITING_FOR_APPLE_SIGNING_CREDENTIAL",
      () => runCapture(["xcrun", "stapler", "validate", app]),
    ],
  ]
  for (const [name, missing, run] of steps) {
    const r = run()
    if (r.code !== 0) {
      console.error(`SIGNATURE GATE FAIL: ${name}\n${r.out.slice(0, 800)}`)
      throw new Error(
        `macOS signature gate failed：${missing}。` +
          `stable 生产发布被拒绝；测试发布请用 --test-feed（muc-updates/test/，无签名要求）。`,
      )
    }
    console.log(`gate OK: ${name}`)
  }
}

/** #6 签名安全门（Windows）：必须在 win32 + signtool 可用，否则拒绝发布 stable。 */
function gateWin(exe: string) {
  if (process.platform !== "win32") {
    throw new Error(
      "Windows signature gate failed：signtool verify 只能在 Windows 上执行；" +
        "mac 交叉构建无法验证签名 → 不允许发布 stable（WAITING_FOR_WINDOWS_SIGNING_CERT；测试发布请用 --test-feed）",
    )
  }
  const r = runCapture(["signtool", "verify", "/pa", "/all", exe])
  if (r.code !== 0) {
    console.error(`SIGNATURE GATE FAIL: signtool verify /pa /all ${exe}\n${r.out.slice(0, 800)}`)
    throw new Error("Windows signature gate failed：缺代码签名证书或签名校验未过——WAITING_FOR_WINDOWS_SIGNING_CERT")
  }
  console.log("gate OK: signtool verify /pa /all")
}

async function upload(execute: boolean, host: string, testFeed: boolean) {
  const version = await getMucVersion()
  const manifest = JSON.parse(readFileSync(`${DIST}/muc-release-manifest.json`, "utf8"))
  if (manifest.version !== version) throw new Error(`manifest version ${manifest.version} != ${version}（先重新 build）`)

  const isMac = manifest.target.startsWith("mac")
  const arch = isMac ? (manifest.target === "mac-arm64" ? "arm64" : "x64") : "x64"
  const feedDir = testFeed ? "test" : "stable"
  const remoteDir = isMac
    ? `${REMOTE_ROOT}/muc-updates/${feedDir}/mac/${arch}`
    : `${REMOTE_ROOT}/muc-updates/${feedDir}/win/x64`
  const channelFile = isMac ? "latest-mac.yml" : "latest.yml"
  const payloadFiles = (manifest.files as Array<{ file: string }>).map((f) => f.file)

  const localOf = (file: string) => `${DIST}/${file}`
  for (const file of payloadFiles) {
    if (!existsSync(localOf(file))) throw new Error(`local payload missing: ${file}`)
  }
  if (!existsSync(`${DIST}/${channelFile}`)) throw new Error(`missing ${channelFile}`)

  // 0) 签名安全门：stable 必须先过门，失败 → 不产生任何上传/manifest 变更。
  //    manual-install（当前模式）：允许 unsigned 进 stable（用户手动下载安装），显式标记
  //    UNSIGNED_MANUAL_RELEASE；auto-install（未来签名后）：门强制生效，未签名直接失败。
  if (!testFeed) {
    if (RELEASE_MODE === "auto-install") {
      console.log("=== 签名安全门（auto-install stable）===")
      if (isMac) gateMac()
      else gateWin(localOf(payloadFiles[0]!))
    } else {
      console.log("=== UNSIGNED_MANUAL_RELEASE ===")
      console.log("manual-install 模式：允许 unsigned 产物进 stable（用户手动下载安装）；")
      console.log("切换 MUC_UPDATE_MODE=auto-install 后签名门将强制生效。")
    }
    await ensureVersionNotPublished(host, remoteDir, channelFile, version)
  } else {
    console.log("=== --test-feed：跳过签名门（测试 feed，不入 stable）===")
  }

  // #8 manifest 引用完整性：本地核对 latest*.yml 的 url/size/sha512 与实际 payload 一致
  verifyLocalManifest(`${DIST}/${channelFile}`)

  console.log(`\n=== 发布计划 ${version} (${manifest.target}) → ${host}:${remoteDir} ===`)
  console.log("步骤 1: 上传版本化 payload:", payloadFiles.join(", "))
  console.log("步骤 2: 远端 SHA256/大小校验")
  console.log(`步骤 3: 最后上传 manifest: ${channelFile}`)
  if (!testFeed) console.log("步骤 4: 刷新 /downloads 人工别名 + SHA256SUMS.txt")

  if (!execute) {
    console.log("\n(dry-run，未做任何修改；确认无误后加 --execute)")
    return
  }

  // 1) 两阶段上传：/downloads 属主 www:www（admin 无写权限），先 rsync 到家目录 staging，
  //    再 sudo 提交到最终路径 + chown www:www。版本化文件名，永不覆盖已发布版本。
  const stageDir = `/home/admin/mucode-release/${path.posix.relative("/srv/sub2api/data/downloads", remoteDir)}`
  await sh(["ssh", host, `mkdir -p '${stageDir}'`])
  await sh([
    "rsync", "-av", "--partial", "--append",
    "-e", "ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10",
    ...payloadFiles.map((f) => localOf(f)), `${host}:${stageDir}/`,
  ])
  const finalDir = remoteDir
  await sh([
    "ssh",
    host,
    `sudo mkdir -p '${finalDir}' && for f in ${payloadFiles.map((f) => `'${stageDir}/${f}'`).join(" ")}; do sudo cp -f "$f" '${finalDir}/'; done && sudo chown www:www ${payloadFiles.map((f) => `'${finalDir}/${f}'`).join(" ")}`,
  ])

  // 2) 远端校验：sha256/大小 + #8 manifest 引用完整性（sha512/size 必须与 latest*.yml 一致）
  const cm = parseChannelManifest(`${DIST}/${channelFile}`)
  const check = Bun.spawnSync(
    [
      "ssh",
      host,
      `cd ${finalDir} && sha256sum ${payloadFiles.join(" ")} && sha512sum ${payloadFiles.join(" ")} && stat -c '%n %s' ${payloadFiles.join(" ")}`,
    ],
    { stdout: "pipe", stderr: "inherit" },
  )
  if (check.exitCode !== 0) throw new Error("remote verify failed")
  const remoteOut = check.stdout.toString()
  for (const file of payloadFiles) {
    const local = (manifest.files as Array<{ file: string; sha256: string }>).find((f) => f.file === file)
    if (!remoteOut.includes(local!.sha256)) throw new Error(`remote sha256 mismatch: ${file}`)
  }
  for (const f of cm.files) {
    const remoteHex = remoteOut.match(new RegExp(`^([0-9a-f]{128})\\s+${f.url.replace(/\./g, "\\.")}$`, "m"))?.[1]
    if (!remoteHex) throw new Error(`DO_NOT_PUBLISH_MANIFEST: ${f.url} sha512 未在远端找到`)
    const localSha512B64 = sha512(localOf(f.url))
    const remoteB64 = Buffer.from(remoteHex, "hex").toString("base64")
    if (remoteB64 !== localSha512B64) throw new Error(`DO_NOT_PUBLISH_MANIFEST: ${f.url} 远端 sha512 != latest*.yml`)
    const remoteSize = remoteOut.match(new RegExp(`^${f.url.replace(/\./g, "\\.")}\\s+(\\d+)$`, "m"))?.[1]
    if (remoteSize !== String(f.size)) throw new Error(`DO_NOT_PUBLISH_MANIFEST: ${f.url} 远端 size != latest*.yml`)
  }
  console.log("remote payload verify OK（sha256/manifest + sha512/size vs latest*.yml）")

  // 3) manifest 最后发布
  await sh(["scp", `${DIST}/${channelFile}`, `${host}:${stageDir}/${channelFile}`])
  await sh([
    "ssh",
    host,
    `sudo cp -f '${stageDir}/${channelFile}' '${finalDir}/${channelFile}' && sudo chown www:www '${finalDir}/${channelFile}'`,
  ])

  // 4) 人工下载别名（固定文件名，仅首装入口，不参与自动更新；test-feed 不动 /downloads）
  //    #7：别名与本次正式 release 同 commit/同版本/同一次 build——上传后立刻
  //    重生成 SHA256SUMS.txt 并做公网验证（HTTP 200 + Content-Length + SHA256）。
  if (!testFeed) {
    // 别名 = feed 内同一文件的 server 端拷贝（同一次 build 的同一字节，零二次传输）
    const alias = isMac ? `mucode-mac-${arch}.dmg` : `mucode-win-x64.exe`
    const aliasSrc = isMac ? `${finalDir}/mucode-${version}-mac-${arch}.dmg` : `${finalDir}/mucode-${version}-win-x64.exe`
    await sh(["ssh", host, `sudo cp -f '${aliasSrc}' '${REMOTE_ROOT}/${alias}' && sudo chown www:www '${REMOTE_ROOT}/${alias}'`])
    await sh([
      "ssh",
      host,
      `cd ${REMOTE_ROOT} && sudo sha256sum mucode-mac-arm64.dmg mucode-mac-x64.dmg mucode-win-x64.exe > /tmp/SHA256SUMS.txt && sudo cp /tmp/SHA256SUMS.txt SHA256SUMS.txt && sudo chown www:www SHA256SUMS.txt`,
    ])
    const aliasLocalSrc = isMac
      ? `${DIST}/mucode-${version}-mac-${arch}.dmg`
      : `${DIST}/mucode-${version}-win-x64.exe`
    await verifyPublicAliases(host, [[alias, aliasLocalSrc]])
  }
  console.log("发布完成（manifest 已最后上线）")
}

/** #7 公网验证：/downloads 固定别名 HTTP 200 + Content-Length 一致 + 服务器 SHA256 一致。
 *  alias 仅存在于服务器端（由 feed 内同字节文件 server 端拷贝生成），本地对比对象 = 版本化源文件。 */
async function verifyPublicAliases(host: string, pairs: Array<[string, string]>) {
  const base = "https://admin.wuxuexi.top/downloads"
  for (const [alias, localSrc] of pairs) {
    const head = Bun.spawnSync(["curl", "-sI", `${base}/${alias}`], { stdout: "pipe" })
    const headers = head.stdout.toString()
    if (!headers.includes(" 200")) throw new Error(`PUBLIC VERIFY FAIL: ${alias} HTTP 非 200`)
    const localSize = (await Bun.file(localSrc).size).toString()
    const remoteLen = headers.match(/content-length:\s*(\d+)/i)?.[1]
    if (remoteLen !== localSize) throw new Error(`PUBLIC VERIFY FAIL: ${alias} Content-Length ${remoteLen} != 本地 ${localSize}`)
    const localHash = sha256(localSrc)
    const sums = Bun.spawnSync(["ssh", host, `cat ${REMOTE_ROOT}/SHA256SUMS.txt`], { stdout: "pipe" })
    if (sums.exitCode !== 0 || !sums.stdout.toString().includes(localHash)) {
      throw new Error(`PUBLIC VERIFY FAIL: ${alias} 的 SHA256 不在服务器 SHA256SUMS.txt 中`)
    }
    console.log(`public verify OK: ${alias} (200, ${localSize} bytes, sha256 ✓)`)
  }
}

const cmd = process.argv[2]
const arg = process.argv[3]

if (cmd === "version") {
  console.log(await getMucVersion())
} else if (cmd === "bump") {
  if (!arg || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) throw new Error("usage: bump <semver>")
  const current = await getMucVersion()
  const src = `${DESKTOP_DIR}/${MUC_VERSION_SOURCE}`
  writeFileSync(src, JSON.stringify({ version: arg }, null, 2) + "\n")
  console.log(`MUC version: ${current} -> ${arg} (${MUC_VERSION_SOURCE})`)
  console.log("提醒：MUC 版本必须严格递增（electron-updater 不接受降级覆盖发布）。")
} else if (cmd === "build") {
  if (!["mac-arm64", "mac-x64", "win-x64"].includes(arg ?? "")) throw new Error("usage: build mac-arm64|mac-x64|win-x64")
  await build(arg)
} else if (cmd === "verify") {
  if (!["mac-arm64", "mac-x64", "win-x64"].includes(arg ?? "")) throw new Error("usage: verify mac-arm64|mac-x64|win-x64")
  await verifyBuild(arg, await getMucVersion())
} else if (cmd === "upload") {
  const execute = process.argv.includes("--execute")
  const testFeed = process.argv.includes("--test-feed")
  const hostIdx = process.argv.indexOf("--host")
  await upload(execute, hostIdx > 0 ? process.argv[hostIdx + 1] : DEFAULT_HOST, testFeed)
} else {
  console.log("usage: muc-release.ts version|bump <ver>|build|verify|upload [--execute] [--test-feed] [--host user@host]")
}
