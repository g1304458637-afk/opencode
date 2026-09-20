#!/usr/bin/env node
// MUC Harness: 生成 latest-mucode.json —— mucode 更新自检（src/main/muc/update-check.ts）
// 与网站 /muc 页版本区块的唯一版本源。打包完成后运行：
//
//   node scripts/muc-manifest.mjs --dist dist [--notes "..."] [--min-supported x.y.z-muc.n]
//
// 扫描 dist/ 下的 mucode-* 安装包，计算 SHA256，写 latest-mucode.json 到 dist/。
// 发布时把安装包、SHA256SUMS 与该文件一并上传到 admin.wuxuexi.top 的 /downloads/。

import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const OFFICIAL_DOWNLOADS_BASE = "https://admin.wuxuexi.top/downloads"

// 产物名 → manifest 键（与 /muc 页 downloadOptions 对应）
const KNOWN_ARTIFACTS = [
  { file: "mucode-mac-arm64.dmg", key: "mac-arm64" },
  { file: "mucode-mac-x64.dmg", key: "mac-x64" },
  { file: "mucode-win-x64.exe", key: "win-x64" },
]

function parseArgs(argv) {
  const args = {
    dist: "dist",
    out: undefined,
    notes: undefined,
    minSupported: undefined,
    releasedAt: undefined,
    version: undefined,
  }
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]
    if (!name.startsWith("--")) continue
    const key = name.slice(2)
    const aliases = { "min-supported": "minSupported", "released-at": "releasedAt" }
    const canonical = aliases[key] ?? key
    if (canonical === "dist" || canonical === "out" || canonical === "notes" || canonical === "minSupported" || canonical === "releasedAt" || canonical === "version") {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`--${key} 需要一个值`)
      args[canonical] = value
      i++
    }
  }
  return args
}

// 默认版本 = package.json version + electron-builder.config.ts 的 MUC_BUILD
async function resolveVersion(packageDir) {
  const pkg = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"))
  const base = typeof pkg.version === "string" ? pkg.version : "0.0.0"
  if (/-muc\.\d+$/.test(base)) return base
  const config = await readFile(path.join(packageDir, "electron-builder.config.ts"), "utf8")
  const match = /const MUC_BUILD = (\d+)/.exec(config)
  if (!match) {
    console.warn(`[muc-manifest] 无法从 electron-builder.config.ts 解析 MUC_BUILD，使用 ${base}`)
    return base
  }
  return `${base}-muc.${match[1]}`
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    hash.on("error", reject)
    const stream = createReadStream(filePath)
    stream.on("error", reject)
    stream.on("data", chunk => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const distDir = path.isAbsolute(args.dist) ? args.dist : path.join(process.cwd(), args.dist)

  let distFiles
  try {
    distFiles = new Set(await readdir(distDir))
  } catch {
    throw new Error(`dist 目录不存在或不可读: ${distDir}（先运行打包）`)
  }

  const downloads = {}
  const missing = []
  for (const artifact of KNOWN_ARTIFACTS) {
    if (!distFiles.has(artifact.file)) {
      missing.push(artifact.file)
      continue
    }
    const abs = path.join(distDir, artifact.file)
    const info = await stat(abs)
    downloads[artifact.key] = {
      file: artifact.file,
      url: `${OFFICIAL_DOWNLOADS_BASE}/${artifact.file}`,
      sha256: await sha256File(abs),
      size: info.size,
    }
  }
  if (missing.length === KNOWN_ARTIFACTS.length) {
    throw new Error(`dist 下没有找到任何 mucode 安装包: ${distDir}`)
  }
  if (missing.length > 0) {
    console.warn(`[muc-manifest] 警告: 缺少产物（manifest 将不含对应平台）: ${missing.join(", ")}`)
  }

  const manifest = {
    version: args.version || (await resolveVersion(packageDir)),
    releasedAt: args.releasedAt || new Date().toISOString(),
    ...(args.notes ? { notes: args.notes } : {}),
    ...(args.minSupported ? { minSupported: args.minSupported } : {}),
    downloads,
  }

  const outPath = path.isAbsolute(args.out || "")
    ? args.out
    : path.join(distDir, args.out || "latest-mucode.json")
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  console.log(`[muc-manifest] 版本 ${manifest.version}`)
  for (const [key, d] of Object.entries(downloads)) {
    console.log(`  ${key.padEnd(10)} ${d.file}  sha256=${d.sha256.slice(0, 16)}…`)
  }
  console.log(`[muc-manifest] 已写入 ${outPath}`)
  console.log("[muc-manifest] 发布提醒: 上传安装包 + latest-mucode.json + SHA256SUMS 到 /downloads/，并在 /muc 页确认版本区块。")
}

main().catch(error => {
  console.error(`[muc-manifest] ${error?.message ?? error}`)
  process.exit(1)
})
