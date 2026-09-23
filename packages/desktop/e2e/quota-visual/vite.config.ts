import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import appPlugin from "@opencode-ai/app/vite"

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    appPlugin,
    {
      name: "dev-only-quota-fixture",
      apply: "build",
      buildStart() {
        throw new Error("Quota visual fixture is development-only")
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 4486,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] },
  },
})
