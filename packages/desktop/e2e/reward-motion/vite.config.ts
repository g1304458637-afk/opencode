import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwind from "@tailwindcss/vite"
import { resolve } from "node:path"
import { resolveBrand } from "../../../brand/src/index"
export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [solid(), tailwind()],
  resolve: {
    alias: {
      "@opencode-ai/brand": resolve(import.meta.dirname, "../../../brand/src/index.ts"),
      "@": resolve(import.meta.dirname, "../../../app/src"),
    },
  },
  define: {
    "import.meta.env.VITE_CAMPUS_REWARD_PREVIEW": JSON.stringify(process.env.CAMPUS_REWARD_PREVIEW === "1"),
    __CAMPUS_BRAND_CONFIG__: JSON.stringify(resolveBrand({ OPENCODE_CHANNEL: process.env.OPENCODE_CHANNEL || "hubu" })),
  },
  server: {
    host: "127.0.0.1",
    port: 4198,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, "../../../../")] },
  },
  build: { outDir: "/tmp/reward-motion-qa-build" },
})
