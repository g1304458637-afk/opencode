import { _electron, expect } from "@playwright/test"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
const profile = "/private/tmp/campus-phase4-dual-profile"
const artifacts = process.env.CAMPUS_E2E_ARTIFACTS!
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 18765,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/v1/models") return Response.json({ data: [{ id: "glm-5-thinking" }] })
    if (path === "/v1/usage") {
      const key = request.headers.get("authorization")
      if (!/^Bearer test-(muc|hubu)-device-key$/.test(key || "")) throw new Error("Unexpected brand credential")
      return Response.json({
        mode: "unrestricted",
        wallet: { balance: key!.includes("hubu") ? "22.00000000" : "11.00000000", canonical_currency: "USD" },
      })
    }
    return Response.json({ version: "0.0.0", downloads: {} })
  },
})
const results: object[] = []
try {
  for (const brand of ["muc", "hubu", "muc"]) {
    const application = await _electron.launch({
      args: [resolve("e2e/launch.mjs")],
      env: {
        ...process.env,
        BRAND: brand,
        OPENCODE_CHANNEL: brand,
        CAMPUS_E2E_MAIN: resolve(`dist/e2e-${brand}/out/main/index.js`),
        CAMPUS_E2E_PROFILE: profile,
        MUC_CDP_PORT: "0",
      },
    })
    try {
      const page = await application.firstWindow()
      await page.waitForFunction(() => !!window.api?.mucGetState)
      const state = await page.evaluate(() => window.api.mucGetState())
      expect(state).toMatchObject({ connected: true, keyName: `${brand}-device` })
      expect(await page.evaluate(() => window.api.mucGetUsage())).toMatchObject({
        ok: true,
        usage: { wallet: { balance: brand === "hubu" ? "22.00000000" : "11.00000000" } },
      })
      const other = brand === "muc" ? "hubu" : "muc"
      const ownFile = join(profile, `cn.edu.${brand}.harness`, `${brand}-credential.bin`)
      const otherFile = join(profile, `cn.edu.${other}.harness`, `${other}-credential.bin`)
      const own = readFileSync(ownFile)
      const foreign = readFileSync(otherFile)
      // First pass may encounter the other brand's legacy file; the next launch migrates it.
      const migrated = own.subarray(0, 8).toString() === "CAMPUS2:"
      expect(migrated).toBe(true)
      writeFileSync(ownFile, foreign)
      expect(await page.evaluate(() => window.api.mucGetState())).toEqual({ connected: false })
      writeFileSync(ownFile, own)
      expect(await page.evaluate(() => window.api.mucGetState())).toMatchObject({ connected: true, keyName: `${brand}-device` })
      let independentKeys: boolean | null = null
      const ownKey = readFileSync(join(profile, `cn.edu.${brand}.harness`, `${brand}-vault-key.bin`)).toString("base64")
      const otherKeyFile = join(profile, `cn.edu.${other}.harness`, `${other}-vault-key.bin`)
      if (existsSync(otherKeyFile)) {
        const foreignKey = readFileSync(otherKeyFile).toString("base64")
        independentKeys = await application.evaluate(({ safeStorage }, wrapped) => {
          const own = JSON.parse(safeStorage.decryptString(Buffer.from(wrapped.ownKey, "base64")))
          const other = JSON.parse(safeStorage.decryptString(Buffer.from(wrapped.foreignKey, "base64")))
          return own.key !== other.key && own.brand !== other.brand
        }, { ownKey, foreignKey })
        expect(independentKeys).toBe(true)
      }
      results.push({ brand, connected: true, deviceId: state.connected ? state.deviceId : null, migrated, crossCredentialRejected: true, independentKeys })
      console.log(`PASS ${brand}: own credential retained; foreign credential rejected; independent vault keys=${independentKeys}`)

    } finally {
      await application.close()
    }
  }
  expect(readFileSync(join(profile, "cn.edu.muc.harness", "muc-device-id"), "utf8")).not.toBe(
    readFileSync(join(profile, "cn.edu.hubu.harness", "hubu-device-id"), "utf8"),
  )
  writeFileSync(artifacts, JSON.stringify({ results, credentialIsolation: "PASS", deviceIsolation: "PASS" }, null, 2))
} finally {
  fixture.stop(true)
}
