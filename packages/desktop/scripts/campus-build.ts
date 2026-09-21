#!/usr/bin/env bun
import { campusConfig } from "./campus-config"
import { resolve } from "node:path"
import { campusNativePackages, prepareCampusNative } from "./campus-native"

const [brand, target] = process.argv.slice(2)
if (!["muc", "hubu"].includes(brand ?? "") || !["mac-arm64", "mac-x64", "win-x64"].includes(target ?? "")) {
  throw new Error("Usage: bun scripts/campus-build.ts muc|hubu mac-arm64|mac-x64|win-x64 [--dry-run] [--package]")
}
const [platform, arch] = target!.split("-")
const env = {
  ...process.env,
  OPENCODE_CHANNEL: brand!,
  BRAND: brand!,
  MUC_PTY_PKG: `@lydell/node-pty-${platform === "mac" ? "darwin" : "win32"}-${arch}`,
  CAMPUS_BUILD_OUTPUT: resolve(`dist/campus/${brand}/${target}`),
}
const config = campusConfig(env)
const commands = [
  ["bun", "run", "prebuild"],
  ["bunx", "--no-install", "electron-vite", "build"],
  ...(process.argv.includes("--package")
    ? [
        [
          "bunx",
          "--no-install",
          "electron-builder",
          `--${platform}`,
          `--${arch}`,
          "--config",
          "electron-builder.config.ts",
          "--publish",
          "never",
        ],
      ]
    : []),
]
console.log(
  JSON.stringify(
    {
      brand: config.brand.id,
      target,
      version: config.version,
      appId: config.brand.appId,
      protocol: config.brand.protocolScheme,
      artifact: config.brand.artifactPrefix,
      feed: config.brand.updates.feed,
      output: env.CAMPUS_BUILD_OUTPUT,
      commands,
      native: campusNativePackages(target!),
    },
    null,
    2,
  ),
)
if (!process.argv.includes("--dry-run")) {
  let failure: unknown
  try {
    for (const command of commands) {
      if (command.includes("electron-builder")) await prepareCampusNative(target!)
      const child = Bun.spawn(command, {
        cwd: resolve(import.meta.dir, ".."),
        env,
        stdout: "inherit",
        stderr: "inherit",
      })
      if (await child.exited) throw new Error(`Campus build failed: ${command.join(" ")}`)
    }
  } catch (error) {
    failure = error
  }
  {
    const restore = Bun.spawn(["bun", "install", "--frozen-lockfile"], {
      cwd: resolve(import.meta.dir, "../../.."),
      stdout: "inherit",
      stderr: "inherit",
    })
    if (await restore.exited) {
      const error = new Error("Could not restore host development dependencies")
      throw failure ? new AggregateError([failure, error], "Build and dependency restore failed") : error
    }
  }
  if (failure) throw failure
}
