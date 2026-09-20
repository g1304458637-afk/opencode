#!/usr/bin/env bun
// MUC Harness: mucode 发布脚本（Phase 7/11）。
//
// 命令：
//   bun scripts/muc-release.ts version
//   bun scripts/muc-release.ts bump 2.0.1
//   bun scripts/muc-release.ts build mac-arm64|mac-x64|win-x64
//   bun scripts/muc-release.ts upload [--execute] [--host admin@host]
//
// 原子发布顺序（upload 子命令内建，顺序不可调换）：
//   1. 版本化 payload（zip/exe/blockmap）先上传
//   2. 远端 SHA256/大小逐字节校验
//   3. 最后上传 latest-mac.yml / latest.yml（manifest 最后出现）
//   4. 刷新 /downloads 人工下载别名（无版本文件名）+ SHA256SUMS.txt
//
// 本脚本只发布 muc-harness 已测试的本地构建产物；不触碰上游 OpenCode。

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"
import { $ } from "bun"
import { getMucVersion, MUC_VERSION_SOURCE } from "./utils"

const DESKTOP_DIR = import.meta.dir.replace(/\/scripts$/, "")
const DIST = `${DESKTOP_DIR}/dist`
const DEFAULT_HOST = process.env.MUC_RELEASE_HOST ?? "admin@112.125.88.123"
const REMOTE_ROOT = "/srv/sub2api/data/downloads"

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

async function sh(cmd: string[]) {
  console.log(`+ ${cmd.join(" ")}`)
  const proc = Bun.spawn(cmd, { cwd: DESKTOP_DIR, stdout: "inherit", stderr: "inherit" })
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
    files.push(
      { file: `mucode-${version}-win-x64.exe`, sha256: sha256(exe), bytes: (await Bun.file(exe).size) },
      { file: `mucode-${version}-win-x64.exe.blockmap`, sha256: sha256(`${exe}.blockmap`), bytes: (await Bun.file(`${exe}.blockmap`).size) },
      { file: `mucode-win-x64.exe`, sha256: sha256(`${DIST}/mucode-win-x64.exe`), bytes: (await Bun.file(`${DIST}/mucode-win-x64.exe`).size) },
    )
  }

  const manifestPath = `${DIST}/muc-release-manifest.json`
  const manifest = {
    target,
    version,
    generatedAt: new Date().toISOString(),
    files,
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  console.log(`verify OK (${target} @ ${version}); manifest → ${manifestPath}`)
}

async function build(target: string) {
  const version = await getMucVersion()
  console.log(`MUC release: building ${target} @ ${version}`)
  process.env.OPENCODE_CHANNEL = "muc"
  // 全量 build（含 prebuild：dist/node 重建 + release.json → package.json 版本同步），
  // 保证渲染层 pkg.version 与 extraMetadata.version 一致。
  await sh(["bun", "run", "build"])
  const eb = ["npx", "electron-builder", "--config", "electron-builder.config.ts", "--publish", "never"]
  if (target === "mac-arm64") await sh([...eb, "--mac", "--arm64"])
  if (target === "mac-x64") await sh([...eb, "--mac", "--x64"])
  if (target === "win-x64") await sh([...eb, "--win", "--x64"])
  await verifyBuild(target, version)
}

async function upload(execute: boolean, host: string) {
  const version = await getMucVersion()
  const manifest = JSON.parse(readFileSync(`${DIST}/muc-release-manifest.json`, "utf8"))
  if (manifest.version !== version) throw new Error(`manifest version ${manifest.version} != ${version}（先重新 build）`)

  const isMac = manifest.target.startsWith("mac")
  const arch = isMac ? (manifest.target === "mac-arm64" ? "arm64" : "x64") : "x64"
  const remoteDir = isMac ? `${REMOTE_ROOT}/muc-updates/stable/mac/${arch}` : `${REMOTE_ROOT}/muc-updates/stable/win/x64`
  const channelFile = isMac ? "latest-mac.yml" : "latest.yml"
  const payloadFiles = manifest.files
    .map((f: { file: string }) => f.file)
    .filter((f: string) => !f.startsWith("mucode-mac") || f.includes(`mac-${arch}`))

  const localOf = (file: string) => `${DIST}/${file}`
  for (const file of payloadFiles) {
    if (!existsSync(localOf(file))) throw new Error(`local payload missing: ${file}`)
  }
  if (!existsSync(`${DIST}/${channelFile}`)) throw new Error(`missing ${channelFile}`)

  console.log(`\n=== 发布计划 ${version} (${manifest.target}) → ${host}:${remoteDir} ===`)
  console.log("步骤 1: 上传版本化 payload:", payloadFiles.join(", "))
  console.log("步骤 2: 远端 SHA256/大小校验")
  console.log(`步骤 3: 最后上传 manifest: ${channelFile}`)
  console.log("步骤 4: 刷新 /downloads 人工别名 + SHA256SUMS.txt")

  if (!execute) {
    console.log("\n(dry-run，未做任何修改；确认无误后加 --execute)")
    return
  }

  // 1) payload（版本化文件名，永不覆盖已发布版本）
  await sh(["rsync", "-av", "--partial", ...payloadFiles.map((f: string) => localOf(f)), `${host}:${remoteDir}/`])

  // 2) 远端校验
  const check = Bun.spawnSync(
    ["ssh", host, `cd ${remoteDir} && sha256sum ${payloadFiles.join(" ")} && stat -c '%n %s' ${payloadFiles.join(" ")}`],
    { stdout: "pipe", stderr: "inherit" },
  )
  if (check.exitCode !== 0) throw new Error("remote verify failed")
  for (const file of payloadFiles) {
    const local = manifest.files.find((f: { file: string }) => f.file === file)
    if (!check.stdout.toString().includes(local.sha256)) throw new Error(`remote sha256 mismatch: ${file}`)
  }
  console.log("remote payload verify OK")

  // 3) manifest 最后发布
  await sh(["scp", `${DIST}/${channelFile}`, `${host}:${remoteDir}/${channelFile}`])

  // 4) 人工下载别名（固定文件名，仅首装入口，不参与自动更新）
  if (isMac) {
    await sh(["scp", `${DIST}/mucode-${version}-mac-${arch}.dmg`, `${host}:${REMOTE_ROOT}/mucode-mac-${arch}.dmg`])
  } else {
    await sh(["scp", `${DIST}/mucode-${version}-win-x64.exe`, `${host}:${REMOTE_ROOT}/mucode-win-x64.exe`])
  }
  await sh([
    "ssh",
    host,
    `cd ${REMOTE_ROOT} && sha256sum mucode-mac-arm64.dmg mucode-mac-x64.dmg mucode-win-x64.exe > SHA256SUMS.txt`,
  ])
  console.log("发布完成（manifest 已最后上线）")
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
} else if (cmd === "upload") {
  const execute = process.argv.includes("--execute")
  const hostIdx = process.argv.indexOf("--host")
  await upload(execute, hostIdx > 0 ? process.argv[hostIdx + 1] : DEFAULT_HOST)
} else {
  console.log("usage: muc-release.ts version|bump <ver>|build <target>|upload [--execute] [--host user@host]")
}
