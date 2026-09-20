#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { $ } from "bun"

import { downloadCliToResources, resolveChannel, syncMucVersionToPackageJson } from "./utils"

const channel = resolveChannel()
// MUC Harness: 渲染层 bundle 读取 package.json 的 version，必须在打包前与 release.json 对齐
await syncMucVersionToPackageJson(channel)
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
// MUC Harness: v1 sidecar 不执行该 CLI（仅 v2 路径使用）；网络不通时复用已有副本
if (channel === "dev" || channel === "muc") {
  try {
    await downloadCliToResources()
  } catch (error) {
    if (!existsSync("resources/opencode-cli")) throw error
    console.warn("opencode-cli download failed; reusing existing copy")
  }
}
