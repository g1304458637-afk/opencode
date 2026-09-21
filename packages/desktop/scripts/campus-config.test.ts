import { expect, test } from "bun:test"
import { campusConfig } from "./campus-config"
import { campusNativePackages } from "./campus-native"

for (const brand of ["muc", "hubu"]) {
  for (const target of ["mac-arm64", "mac-x64", "win-x64"]) {
    test(`${brand} ${target}: identity, version and download namespace`, () => {
      const configured = campusConfig({ OPENCODE_CHANNEL: brand, CAMPUS_LOCAL_BUILD: "1" })
      expect(configured.brand.appId).toBe(`cn.edu.${brand}.harness`)
      expect(configured.brand.protocolScheme).toBe(brand)
      expect(configured.brand.credentialNamespace).toBe(brand)
      expect(configured.brand.updates.feed).toContain(`/${brand}-updates/`)
      expect(configured.brand.updates.manifest).toContain(configured.brand.artifactPrefix)
      expect(Object.values(configured.brand.downloads).some((name) => name.includes(target))).toBe(true)
      expect(configured.version).toBeTruthy()
      const native = campusNativePackages(target)
      expect(native.packages).toContain(
        `@lydell/node-pty-${target.startsWith("mac") ? "darwin" : "win32"}-${target.split("-")[1]}`,
      )
    })
  }
}

test("HUBU production never silently adopts a local or MUC feed", () => {
  expect(() => campusConfig({ OPENCODE_CHANNEL: "hubu" })).toThrow("HUBU production build requires")
  expect(() => campusConfig({ OPENCODE_CHANNEL: "muc", BRAND: "hubu" })).toThrow("conflicts")
  expect(() => campusConfig({ OPENCODE_CHANNEL: "muc", MUC_UPDATE_FEED_URL: "http://untrusted.example/feed" })).toThrow(
    "HTTPS",
  )
})

test("MUC release credentials use HTTPS on the first hop", () => {
  expect(campusConfig({ OPENCODE_CHANNEL: "muc" }).brand.gatewayURL).toBe("https://admin.wuxuexi.top")
  for (const local of [undefined, "1"]) {
    expect(() =>
      campusConfig({ OPENCODE_CHANNEL: "muc", CAMPUS_LOCAL_BUILD: local, MUC_GATEWAY_URL: "http://admin.wuxuexi.top" }),
    ).toThrow("HTTPS")
  }
  expect(() => campusConfig({ OPENCODE_CHANNEL: "muc", MUC_GATEWAY_URL: "http://localhost:8081" })).toThrow("HTTPS")
  expect(
    campusConfig({ OPENCODE_CHANNEL: "muc", CAMPUS_LOCAL_BUILD: "1", MUC_GATEWAY_URL: "http://localhost:8081" }).brand
      .gatewayURL,
  ).toBe("http://localhost:8081")
})
