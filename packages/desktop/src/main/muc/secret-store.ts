// MUC Harness: 凭据安全存储。
// macOS 上 Electron safeStorage 由 Keychain 背书；密文落盘 userData，
// 明文仅存在于调用进程内存。禁止把凭据写入 config/日志/localStorage。

import { safeStorage } from "electron"
import fs from "node:fs"
import path from "node:path"
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto"
import { resolveBrand } from "@opencode-ai/brand"

export type MucCredential = {
  brand?: string
  gateway: string
  apiKey: string
  keyName: string
  deviceId: string
  user: string
  connectedAt: string
}

export type MucConnectionState =
  | { connected: false }
  | {
      connected: true
      gateway: string
      keyName: string
      deviceId: string
      user: string
      connectedAt: string
    }

export class MucSecretStore {
  private file: string
  private keyFile: string
  private namespace = resolveBrand().credentialNamespace
  private deviceId: string

  constructor(userDataDir: string) {
    // 各品牌凭据文件隔离（muc 保持历史文件名，老用户凭据不失效）
    const prefix = resolveBrand().credentialNamespace
    this.file = path.join(userDataDir, `${prefix}-credential.bin`)
    this.keyFile = path.join(userDataDir, `${prefix}-vault-key.bin`)
    // 设备 ID 非机密，明文存放，用于 per-device Key 撤销对账
    const idFile = path.join(userDataDir, `${prefix}-device-id`)
    try {
      this.deviceId = fs.readFileSync(idFile, "utf8").trim()
    } catch {
      this.deviceId = randomUUID()
      fs.mkdirSync(path.dirname(idFile), { recursive: true })
      fs.writeFileSync(idFile, this.deviceId, { mode: 0o600 })
    }
  }

  getDeviceId(): string {
    return this.deviceId
  }

  static isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  async set(credential: Omit<MucCredential, "deviceId" | "connectedAt">): Promise<MucConnectionState> {
    if (!MucSecretStore.isEncryptionAvailable()) {
      throw new Error("secure storage unavailable on this platform")
    }
    const full: MucCredential = {
      ...credential,
      brand: resolveBrand().credentialNamespace,
      deviceId: this.deviceId,
      connectedAt: new Date().toISOString(),
    }
    this.write(full)
    return this.getState()
  }

  async get(): Promise<MucCredential | null> {
    try {
      const raw = fs.readFileSync(this.file)
      if (!MucSecretStore.isEncryptionAvailable()) return null
      const current = raw.subarray(0, 8).toString() === "CAMPUS2:"
      const json = current ? this.decrypt(raw.subarray(8)) : safeStorage.decryptString(raw)
      const parsed = JSON.parse(json) as MucCredential
      if (!parsed.apiKey || !parsed.gateway) return null
      if (parsed.brand && parsed.brand !== resolveBrand().credentialNamespace) return null
      // Upgrade only this brand's legacy file, preserving device identity and connection timestamp.
      if (!current) this.write({ ...parsed, brand: this.namespace })
      return parsed
    } catch {
      return null
    }
  }

  private key(create: boolean): Buffer {
    if (!fs.existsSync(this.keyFile)) {
      if (!create) throw new Error("Missing campus vault key")
      fs.mkdirSync(path.dirname(this.keyFile), { recursive: true, mode: 0o700 })
      const wrapped = safeStorage.encryptString(
        JSON.stringify({ brand: this.namespace, key: randomBytes(32).toString("base64") }),
      )
      // A second process must reuse an existing key, never replace it underneath a credential.
      try {
        fs.writeFileSync(this.keyFile, wrapped, { mode: 0o600, flag: "wx", flush: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
    }
    const wrapped = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.keyFile)))
    if (wrapped.brand !== this.namespace) throw new Error("Campus vault identity mismatch")
    const key = Buffer.from(wrapped.key, "base64")
    if (key.length !== 32) throw new Error("Invalid campus vault key")
    return key
  }

  private write(credential: MucCredential) {
    const key = this.key(true)
    try {
      const nonce = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, nonce)
      cipher.setAAD(Buffer.from(this.namespace))
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()])
      const envelope = Buffer.from(
        JSON.stringify({
          nonce: nonce.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: encrypted.toString("base64"),
        }),
      )
      const temporary = `${this.file}.${randomUUID()}.tmp`
      fs.writeFileSync(temporary, Buffer.concat([Buffer.from("CAMPUS2:"), envelope]), { mode: 0o600, flush: true })
      fs.renameSync(temporary, this.file)
    } finally {
      key.fill(0)
    }
  }

  private decrypt(raw: Buffer): string {
    const key = this.key(false)
    try {
      const envelope = JSON.parse(raw.toString())
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"))
      decipher.setAAD(Buffer.from(this.namespace))
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
      return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8")
    } finally {
      key.fill(0)
    }
  }

  async clear(): Promise<void> {
    try {
      fs.rmSync(this.file, { force: true })
    } catch {
      // 文件不存在视为已清除
    }
  }

  async getState(): Promise<MucConnectionState> {
    const cred = await this.get()
    if (!cred) return { connected: false }
    return {
      connected: true,
      gateway: cred.gateway,
      keyName: cred.keyName,
      deviceId: cred.deviceId,
      user: cred.user,
      connectedAt: cred.connectedAt,
    }
  }
}
