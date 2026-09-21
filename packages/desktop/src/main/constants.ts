import { app } from "electron"
import { resolveBrand } from "@opencode-ai/brand"

type Channel = "dev" | "beta" | "prod" | "muc" | "hubu"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel =
  raw === "dev" || raw === "beta" || raw === "prod" || raw === "muc" || raw === "hubu" ? raw : "dev"

// MUC Harness: muc 通道启用自有更新源（generic provider → admin.wuxuexi.top/downloads/muc-updates，
// publish 配置见 electron-builder.config.ts），绝不指向上游 GitHub Releases/npm。
// dev 仍禁用；prod/beta 维持原语义。MUC_DISABLE_AUTO_UPDATE=1 可一键关闭（故障逃生门）。
// hubu 通道不接入任何自动更新（发布走自有渠道），且避免网络阻塞启动。
export const UPDATER_ENABLED =
  app.isPackaged &&
  (resolveBrand().campus
    ? process.env[`${resolveBrand().id.toUpperCase()}_DISABLE_AUTO_UPDATE`] !== "1"
    : CHANNEL !== "dev")

// MUC Harness: MUC 更新模式（产品策略单一开关）。
// - "manual-install"（当前）：自动检查 + 提醒 + 用户手动下载安装（shell.openExternal 官方 DMG/EXE）。
//   不调用 downloadUpdate / quitAndInstall，不进 Squirrel/NSIS 自动安装链。
// - "auto-install"（未来签名后）：现有 electron-updater 自动下载/自动安装链，一键切回。
// 仅影响 muc 渠道；上游 prod/beta 恒为 auto-install。
export const MUC_UPDATE_MODE: "manual-install" | "auto-install" =
  resolveBrand().campus ? "manual-install" : "auto-install"
