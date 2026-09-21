import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

for (const brand of ["muc", "hubu"]) {
  for (const target of ["darwin-arm64", "darwin-x64", "win32-x64"]) {
    test(`${brand}/${target}: complete campus installer identity`, async () => {
      const previous = { channel: process.env.OPENCODE_CHANNEL, local: process.env.CAMPUS_LOCAL_BUILD, pty: process.env.MUC_PTY_PKG }
      process.env.OPENCODE_CHANNEL = brand
      process.env.CAMPUS_LOCAL_BUILD = "1"
      process.env.MUC_PTY_PKG = `@lydell/node-pty-${target}`
      try {
        const config = (await import(`./electron-builder.config.ts?brand=${brand}&target=${target}`)).default as Configuration
        expect(config.appId).toBe(`cn.edu.${brand}.harness`)
        expect(config.productName).toBe(brand === "muc" ? "mucode" : "HUBU AI")
        expect(config.protocols).toEqual({ name: `${brand.toUpperCase()} Connect`, schemes: [brand] })
        expect(JSON.stringify(config.publish)).toContain(`/${brand}-updates/stable/\${os}/\${arch}`)
        expect(config.mac?.artifactName).toContain(brand === "muc" ? "mucode-" : "hubu-ai-")
        expect(config.extraMetadata?.version).toBeTruthy()
        expect(config.mac?.icon).toContain(`/${brand}/`)
        expect(config.win?.icon).toContain(`/${brand}/`)
        expect(config.afterSign).toBe("scripts/after-sign-mac.js")
      } finally {
        for (const [key, value] of [["OPENCODE_CHANNEL", previous.channel], ["CAMPUS_LOCAL_BUILD", previous.local], ["MUC_PTY_PKG", previous.pty]]) {
          if (value === undefined) delete process.env[key!]
          else process.env[key!] = value
        }
      }
    })
  }
}

const legacyDesktopEntry = "resources/linux/opencode-desktop.desktop"

const channels = [
  { channel: "dev", appId: "ai.opencode.desktop.dev" },
  { channel: "beta", appId: "ai.opencode.desktop.beta" },
  { channel: "prod", appId: "ai.opencode.desktop" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })
}

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?compat=prod")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(
    config.deb?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)
  expect(
    config.rpm?.fpm?.some((entry) =>
      entry.endsWith("opencode-desktop.desktop=/usr/share/applications/opencode-desktop.desktop"),
    ),
  ).toBe(true)

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/OpenCode/ai.opencode.desktop %U")
  expect(desktop).toContain("Icon=ai.opencode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opencode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})

test("bundles the CLI outside the dev app archive", async () => {
  const previous = process.env.OPENCODE_CHANNEL
  process.env.OPENCODE_CHANNEL = "dev"
  const module = await import("./electron-builder.config.ts?cli-resource")
  const config = module.default as Configuration
  if (previous === undefined) delete process.env.OPENCODE_CHANNEL
  else process.env.OPENCODE_CHANNEL = previous

  expect(config.files).toContain("!resources/opencode-cli*")
  expect(config.extraResources).toContainEqual({
    from: "resources/",
    to: "",
    filter: ["opencode-cli*"],
  })
})

for (const channel of ["beta", "prod"] as const) {
  test(`does not bundle the CLI in ${channel} builds`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel
    const module = await import(`./electron-builder.config.ts?no-cli-resource=${channel}`)
    const config = module.default as Configuration
    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.extraResources).not.toContainEqual({
      from: "resources/",
      to: "",
      filter: ["opencode-cli*"],
    })
  })
}
