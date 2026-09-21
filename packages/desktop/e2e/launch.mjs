// Test-only entrypoint: the actual built main/preload/renderer run against an isolated profile.
import { app, shell, dialog, Notification } from 'electron'
import { mkdirSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const root = process.env.CAMPUS_E2E_PROFILE
if (!root) throw new Error('CAMPUS_E2E_PROFILE is required')
mkdirSync(root, { recursive: true })
app.setPath('appData', root)
app.setPath('userData', root)
const record = (kind, value) => appendFileSync(`${root}/events.jsonl`, JSON.stringify({ kind, value }) + '\n')
// Capture OS integration boundaries without registering the test app over a user's installed app.
app.setAsDefaultProtocolClient = (scheme) => { record('protocol', scheme); return true }
shell.openExternal = async (url) => { record('open', url) }
dialog.showMessageBoxSync = (options) => { record('dialog', options.title); return 0 }
Notification.prototype.show = function () { record('notification', this.title) }
await import(pathToFileURL(process.env.CAMPUS_E2E_MAIN).href)
