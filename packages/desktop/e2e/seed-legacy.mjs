// Test-only: reproduce the pre-consolidation encrypted format with no brand field.
import { app, BrowserWindow, safeStorage } from "electron"
import { mkdirSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
const root = process.env.CAMPUS_E2E_PROFILE
if (!root) throw new Error("CAMPUS_E2E_PROFILE is required")
app.setPath("userData", root)
app.whenReady().then(() => {
  for (const brand of ["muc", "hubu"]) {
    const directory = `${root}/cn.edu.${brand}.harness`
    mkdirSync(directory, { recursive: true })
    const deviceId = randomUUID()
    writeFileSync(`${directory}/${brand}-device-id`, deviceId, { mode: 0o600 })
    const credential = {
      gateway: "http://127.0.0.1:18765",
      apiKey: `test-${brand}-device-key`,
      keyName: `${brand}-device`,
      deviceId,
      user: "isolated legacy fixture",
      connectedAt: "2026-09-21T00:00:00Z",
    }
    writeFileSync(`${directory}/${brand}-credential.bin`, safeStorage.encryptString(JSON.stringify(credential)), {
      mode: 0o600,
    })
  }
  const window = new BrowserWindow({ show: false })
  window.loadURL("about:blank")
})
