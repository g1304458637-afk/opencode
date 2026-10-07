import { expect, test } from "bun:test"
import { campusConfig } from "./campus-config"
import { campusNativePackages } from "./campus-native"

const productionHubu = {
  OPENCODE_CHANNEL: "hubu",
  HUBU_GATEWAY_URL: "https://hubu.example.test",
  HUBU_UPDATE_FEED_URL: "https://hubu.example.test/downloads/hubu-updates/stable",
  HUBU_MANIFEST_URL: "https://hubu.example.test/downloads/latest-hubu-ai.json",
  HUBU_DOWNLOAD_BASE_URL: "https://hubu.example.test/downloads",
  HUBU_WEBSITE_URL: "https://hubu.example.test/hubu",
}

test("HUBU registry is independent and explicit in production", () => {
  expect(() => campusConfig(productionHubu)).toThrow("HUBU_SKILL_REGISTRY_URL")
  expect(() =>
    campusConfig({ ...productionHubu, KCODE_SKILL_REGISTRY_URL: "https://kai.example.test/skills" }),
  ).toThrow("HUBU_SKILL_REGISTRY_URL")
  const configured = campusConfig({
    ...productionHubu,
    HUBU_SKILL_REGISTRY_URL: "https://hubu.example.test/hubu-skills/",
  })
  expect(configured.skillRegistryURL).toBe("https://hubu.example.test/hubu-skills/")
  expect(configured.version).toBe("2.1.11")
  expect(configured.brand.gatewayURL).toBe(productionHubu.HUBU_GATEWAY_URL)
  expect(configured.brand.updates.feed).toBe(productionHubu.HUBU_UPDATE_FEED_URL)
})

test("HUBU registry validates transport and never embeds query credentials", () => {
  for (const url of [
    "http://hubu.example.test/hubu-skills",
    "https://user:password@hubu.example.test/hubu-skills",
    "https://hubu.example.test/hubu-skills#token",
    "https://hubu.example.test/hubu-skills?token=secret",
    "file:///skills",
    "http://127.0.0.1:4492",
  ]) {
    expect(() => campusConfig({ ...productionHubu, HUBU_SKILL_REGISTRY_URL: url })).toThrow()
  }
  expect(
    campusConfig({
      OPENCODE_CHANNEL: "hubu",
      CAMPUS_LOCAL_BUILD: "1",
      HUBU_SKILL_REGISTRY_URL: "http://127.0.0.1:4492",
    }).skillRegistryURL,
  ).toBe("http://127.0.0.1:4492")
})

test("local HUBU supports offline skills without adopting KCode registry or changing other brands", () => {
  expect(
    campusConfig({
      OPENCODE_CHANNEL: "hubu",
      CAMPUS_LOCAL_BUILD: "1",
      KCODE_SKILL_REGISTRY_URL: "https://kai.example.test",
    }).skillRegistryURL,
  ).toBeUndefined()
  expect(
    campusConfig({ OPENCODE_CHANNEL: "muc", HUBU_SKILL_REGISTRY_URL: "http://unused.invalid" }).skillRegistryURL,
  ).toBeUndefined()
})

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
