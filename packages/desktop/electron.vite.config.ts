import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "electron-vite"
import appPlugin from "@opencode-ai/app/vite"
import * as fs from "node:fs/promises"
import { readFileSync } from "node:fs"

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc" || raw === "hubu") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

// MUC Harness: muc 渠道渲染层版本注入（只读 release.json，绝不写回 package.json）。
// 其余渠道不定义该宏，渲染层回退到自身 package.json 版本（上游 prod/beta 行为不变）。
const mucVersion = (() => {
  if (channel !== "muc") return null
  const release = JSON.parse(readFileSync(new URL("./resources/muc/release.json", import.meta.url), "utf8"))
  if (typeof release.version !== "string") throw new Error("resources/muc/release.json: missing version")
  return release.version
})()

const nodePtyPkg = (() => {
  // MUC Harness: node-pty 平台包必须跟随【打包目标】平台+架构，而不是构建机的
  // process.platform/process.arch——否则 arm64 机构建的 x64 包会 require darwin-arm64
  // 包，在 x64 运行时找不到 prebuilds/darwin-x64 直接启动崩溃（实测）。
  // release 脚本按 target 注入 MUC_PTY_PKG；未注入时回退构建机（dev/上游 CI 行为不变）。
  return process.env.MUC_PTY_PKG ?? `@lydell/node-pty-${process.platform}-${process.arch}`
})()

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts", sidecar: "src/main/sidecar.ts" },
        // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
        // corrupt bundled TypeScript, while a Rollup banner places the shim safely.
        output: {
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opencode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "opencode:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    define: {
      // MUC Harness: 渲染层通道（titlebar 徽标按此判断；muc 不显示 DEV 徽标）
      "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
      // MUC Harness: muc 渠道版本（与 Info.plist / latest*.yml 同源于 release.json）
      ...(mucVersion ? { "import.meta.env.MUC_VERSION": JSON.stringify(mucVersion) } : {}),
    },
    plugins: [appPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
