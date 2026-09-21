#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { campusConfig } from "./campus-config"

const brandId = process.argv[2]
if (brandId !== "muc" && brandId !== "hubu")
  throw new Error("Usage: bun scripts/campus-manifest.ts muc|hubu [output-directory]")
const { brand, version } = campusConfig({ ...process.env, OPENCODE_CHANNEL: brandId, BRAND: brandId })
const output = resolve(process.argv[3] || `dist/campus/${brandId}`)
const downloads: Record<string, { file: string; url: string; sha256: string; size: number }> = {}
for (const target of ["mac-arm64", "mac-x64", "win-x64"]) {
  const file = `${brand.artifactPrefix}-${version}-${target}.${target.startsWith("mac") ? "dmg" : "exe"}`
  const path = resolve(`dist/campus/${brandId}/${target}`, file)
  if (!existsSync(path)) continue // Never advertise an unbuilt platform.
  const bytes = readFileSync(path)
  downloads[target] = {
    file,
    url: `${brand.updates.downloadBase.replace(/\/+$/, "")}/${file}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  }
}
if (!Object.keys(downloads).length) throw new Error("No campus installers found")
mkdirSync(output, { recursive: true })
const manifest = { brand: brandId, version, releasedAt: new Date().toISOString(), downloads }
const path = join(output, `latest-${brand.artifactPrefix}.json`)
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n")
console.log(path)
