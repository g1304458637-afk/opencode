// MUC Harness: muc 通道无 Developer ID 证书 —— 打包后做 ad-hoc 签名，
// 让下载副本至少具备有效签名（避免 macOS 报 "damaged"；正式分发仍需 Developer ID + notarization）。
import { execSync } from "node:child_process"

export default async function (context) {
  if (context.electronPlatformName !== "darwin") return
  if (!["muc", "hubu"].includes(process.env.OPENCODE_CHANNEL)) return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  console.log(`MUC Harness: after-sign v3 (xattr+codesign retry) -> ${appPath}`)

  // 打包产物内的扩展属性（quarantine/FinderInfo/provenance）会让 codesign 拒签：
  // "resource fork, Finder information, or similar detritus not allowed"。
  // 系统进程可能在清理后重新附加属性（竞态），故清理+签名循环重试。
  let lastError
  for (let attempt = 1; attempt <= 5; attempt++) {
    execSync(`xattr -cr "${appPath}"`)
    try {
      execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" })
      execSync(`codesign --verify --deep "${appPath}"`, { stdio: "inherit" })
      console.log(`MUC Harness: ad-hoc signed ${appPath} (attempt ${attempt})`)
      return
    } catch (error) {
      lastError = error
      console.warn(`MUC Harness: codesign attempt ${attempt} failed, retrying...`)
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  }
  throw lastError
}
