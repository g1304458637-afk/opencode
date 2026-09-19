import { existsSync } from "node:fs"
import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
// MUC Harness: v1 sidecar 不执行该 CLI（仅 v2 路径使用）；网络不通时复用已有副本
try {
  await downloadCliToResources()
} catch (error) {
  if (!existsSync("resources/opencode-cli")) throw error
  console.warn("opencode-cli download failed; reusing existing copy")
}
