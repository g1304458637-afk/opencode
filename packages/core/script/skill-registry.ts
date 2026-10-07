import { resolveBrand } from "@opencode-ai/brand"
import path from "node:path"
import { SkillRegistryServer } from "../src/skill/registry-server"

const brand = resolveBrand()
const prefix = brand.id === "hubu" ? "HUBU" : "KCODE"
const registry = SkillRegistryServer.create(
  path.resolve(process.env[`${prefix}_SKILL_REGISTRY_DATA`] ?? ".skill-registry"),
  process.env[`${prefix}_SKILL_UPSTREAM_REPOSITORIES`]?.split(",").filter(Boolean),
)
const source = process.argv[2]
if (source) console.log(JSON.stringify(await registry.resolve(source)))
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env[`${prefix}_SKILL_REGISTRY_PORT`] ?? (brand.id === "hubu" ? 4492 : 4491)),
  maxRequestBodySize: 8192,
  fetch: registry.fetch,
})
console.log(`${brand.appName} Skill Registry: ${server.url}`)
