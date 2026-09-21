import { resolveBrand } from "@opencode-ai/brand"

const brand = resolveBrand()
const DEFAULT_GATEWAY = brand.gatewayURL || "https://admin.wuxuexi.top"

export function validateCampusGateway(
  raw: string,
  local = import.meta.env?.CAMPUS_LOCAL_BUILD === "1" || process.env.NODE_ENV === "test",
): string {
  const url = new URL(raw)
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.username || url.password || url.hash || url.search || (url.pathname !== "/" && url.pathname !== ""))
    throw new Error("Invalid campus gateway origin")
  if (url.protocol !== "https:" && !(local && loopback && url.protocol === "http:"))
    throw new Error("Campus gateway requires HTTPS")
  return url.origin
}

export function mucGatewayBaseURL(): string {
  return validateCampusGateway(process.env[brand.gatewayEnvVar]?.trim() || DEFAULT_GATEWAY)
}
