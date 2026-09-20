import { app } from "electron"

type Channel = "dev" | "beta" | "prod" | "muc"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel =
  raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc" ? raw : "dev"

// MUC Harness: muc 通道启用自有更新源（generic provider → admin.wuxuexi.top/downloads/muc-updates，
// publish 配置见 electron-builder.config.ts），绝不指向上游 GitHub Releases/npm。
// dev 仍禁用；prod/beta 维持原语义。MUC_DISABLE_AUTO_UPDATE=1 可一键关闭（故障逃生门）。
export const UPDATER_ENABLED =
  app.isPackaged &&
  (CHANNEL === "muc"
    ? process.env.MUC_DISABLE_AUTO_UPDATE !== "1"
    : CHANNEL !== "dev")
