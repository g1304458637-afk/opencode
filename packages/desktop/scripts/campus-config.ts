import { resolveBrand } from "@opencode-ai/brand"
import { readFileSync } from "node:fs"

/** Shared build inputs for main, renderer and installer; never derive update URLs from a credential. */
export function campusConfig(env: NodeJS.ProcessEnv = process.env) {
  const channel = env.OPENCODE_CHANNEL ?? "dev"
  const brand = resolveBrand({ OPENCODE_CHANNEL: channel })
  if (env.BRAND && env.BRAND !== brand.id) throw new Error("BRAND conflicts with OPENCODE_CHANNEL")
  if (!brand.campus) return { brand, version: null }
  const prefix = brand.id.toUpperCase()
  const local = env.CAMPUS_LOCAL_BUILD === "1"
  if (brand.id === "hubu" && !local) {
    for (const suffix of ["GATEWAY_URL", "UPDATE_FEED_URL", "MANIFEST_URL", "DOWNLOAD_BASE_URL", "WEBSITE_URL"]) {
      if (!env[`${prefix}_${suffix}`]) throw new Error(`HUBU production build requires ${prefix}_${suffix}`)
    }
  }
  const configured = {
    ...brand,
    gatewayURL: env[brand.gatewayEnvVar] || brand.gatewayURL,
    updates: {
      feed: env[`${prefix}_UPDATE_FEED_URL`] || brand.updates.feed,
      manifest: env[`${prefix}_MANIFEST_URL`] || brand.updates.manifest,
      downloadPage: env[`${prefix}_WEBSITE_URL`] || brand.updates.downloadPage,
      downloadBase: env[`${prefix}_DOWNLOAD_BASE_URL`] || brand.updates.downloadBase,
    },
  }
  for (const value of [configured.gatewayURL, ...Object.values(configured.updates)]) {
    const url = new URL(value)
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("Invalid campus endpoint")
    }
    // Retain the existing MUC gateway compatibility default; all downloads/feed require TLS.
    const legacyMucGateway = brand.id === "muc" && value === brand.gatewayURL
    if (url.protocol !== "https:" && !(local && loopback) && !legacyMucGateway) {
      throw new Error("Campus endpoints require HTTPS (local builds may use loopback HTTP)")
    }
  }
  const release = JSON.parse(readFileSync(new URL(`../resources/${brand.id}/release.json`, import.meta.url), "utf8"))
  if (typeof release.version !== "string" || !/^\d+\.\d+\.\d+(?:-(?:muc|hubu)\.\d+)?$/.test(release.version)) {
    throw new Error("Invalid campus release version")
  }
  return { brand: configured, version: release.version as string }
}
