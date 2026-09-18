#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { $ } from "bun"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
// MUC Harness: 版本只读不写——package.json 是 git tracked 源文件，构建流程禁止改动；
// 渲染层版本经 electron.vite.config.ts 的 MUC_VERSION define 注入，打包版本经
// electron-builder extraMetadata.version 注入（单一来源 resources/muc/release.json）。
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
// MUC Harness: v1 sidecar 不执行该 CLI（仅 v2 路径使用）；网络不通时复用已有副本
if (channel === "dev" || channel === "muc" || channel === "hubu") {
  try {
    await downloadCliToResources()
  } catch (error) {
    if (!existsSync("resources/opencode-cli")) throw error
    console.warn("opencode-cli download failed; reusing existing copy")
  }
}
