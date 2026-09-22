import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { campusConfig } from "../scripts/campus-config"

const { brand, version } = campusConfig()
const source = Bun.spawnSync(["git", "rev-parse", "HEAD"])
if (source.exitCode !== 0) throw new Error("Cannot determine source SHA")
const sourceSha = source.stdout.toString().trim()
const localBuild = process.env.CAMPUS_LOCAL_BUILD === "1"
if (brand.id === "muc" && localBuild) throw new Error("MUC RC must use production HTTPS enforcement")
if (version?.includes("-rc.") && (!brand.updates.feed.includes("/rc") || !brand.updates.manifest.includes("/rc/"))) {
  throw new Error("RC artifacts require isolated RC update endpoints")
}
const distribution = localBuild ? "LOCAL TEST ARTIFACT" : "UNSIGNED MANUAL RELEASE"
if (!brand.campus || !version) throw new Error("Package smoke requires a campus brand")

const output = resolve(process.env.CAMPUS_BUILD_OUTPUT || "dist")
const target = process.env.CAMPUS_TARGET
if (!target || !/^(mac-(arm64|x64)|win-x64)$/.test(target)) throw new Error("Set CAMPUS_TARGET")
if (!existsSync(output)) throw new Error(`Missing package output: ${output}`)

const files: string[] = []
function walk(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path)
    else files.push(path)
  }
}
walk(output)

const requireFile = (predicate: (path: string) => boolean, description: string) => {
  const found = files.find(predicate)
  if (!found) throw new Error(`Missing ${description} in ${output}`)
  if (statSync(found).size === 0) throw new Error(`Empty ${description}: ${found}`)
  return found
}

const platform = target.startsWith("mac-") ? "mac" : "win"
const arch = target.endsWith("arm64") ? "arm64" : "x64"
const stem = `${brand.artifactPrefix}-${version}-${platform}-${arch}`
const artifacts =
  platform === "mac"
    ? [
        requireFile((path) => basename(path) === `${stem}.dmg`, "versioned DMG"),
        requireFile((path) => basename(path) === `${stem}.zip`, "versioned ZIP"),
      ]
    : [requireFile((path) => basename(path) === `${stem}.exe`, "versioned NSIS installer")]

if (platform === "mac") {
  requireFile(
    (path) => path.includes(".app/Contents/MacOS/") && basename(path) === brand.appName,
    "branded macOS executable",
  )
  const info = requireFile((path) => path.endsWith(".app/Contents/Info.plist"), "macOS Info.plist")
  const result = Bun.spawnSync(["plutil", "-p", info])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  const plist = result.stdout.toString()
  for (const expected of [brand.appId, brand.appName, brand.protocolScheme, version]) {
    if (!plist.includes(expected)) throw new Error(`Info.plist missing ${expected}`)
  }
} else {
  requireFile((path) => basename(path) === `${brand.appName}.exe`, "unpacked branded executable")
}

const entries = artifacts.map((path) => {
  const bytes = readFileSync(path)
  return {
    file: basename(path),
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
})
writeFileSync(
  join(output, "package-smoke.json"),
  JSON.stringify(
    {
      sourceSha,
      distribution,
      localBuild,
      gateway: brand.gatewayURL,
      updates: brand.updates,
      brand: brand.id,
      appId: brand.appId,
      protocol: brand.protocolScheme,
      version,
      target,
      artifacts: entries,
    },
    null,
    2,
  ),
)
console.log(JSON.stringify({ verdict: "PASS", brand: brand.id, version, target, artifacts: entries }, null, 2))
