import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import pkg from "../package.json"

export function campusNativePackages(target: string) {
  const [os, arch] = target.split("-")
  if (!["mac-arm64", "mac-x64", "win-x64"].includes(target)) throw new Error("Unsupported campus target")
  const platform = os === "mac" ? "darwin" : "win32"
  return {
    platform,
    arch: arch!,
    packages: [`@lydell/node-pty-${platform}-${arch}`, `@parcel/watcher-${platform}-${arch}`],
  }
}

/** electron-builder's dependency collector ignores files exclusions for native packages. */
export async function prepareCampusNative(target: string) {
  const desktop = resolve(import.meta.dir, "..")
  const root = resolve(desktop, "../..")
  const native = campusNativePackages(target)
  const temporary = mkdtempSync(join(tmpdir(), "campus-native-"))
  try {
    for (const name of native.packages) {
      const destination = join(desktop, "node_modules", name)
      if (existsSync(destination)) continue
      const version = pkg.optionalDependencies[name as keyof typeof pkg.optionalDependencies]
      if (!version) throw new Error(`Missing pinned native dependency: ${name}`)
      const child = Bun.spawn(
        [
          "bun",
          "install",
          "--no-save",
          "--ignore-scripts",
          "--cwd",
          temporary,
          `${name}@${version}`,
          `--os=${native.platform}`,
          `--cpu=${native.arch}`,
        ],
        { stdout: "inherit", stderr: "inherit" },
      )
      if (await child.exited) throw new Error(`Cannot prepare ${name}`)
      rmSync(destination, { force: true, recursive: true })
      cpSync(join(temporary, "node_modules", name), destination, { recursive: true, dereference: true })
    }
    for (const modules of [
      join(desktop, "node_modules"),
      join(root, "node_modules"),
      join(root, "node_modules/.bun/node_modules"),
    ]) {
      for (const [scope, prefix] of [
        ["@lydell", "node-pty-"],
        ["@parcel", "watcher-"],
        ["@msgpackr-extract", "msgpackr-extract-"],
      ]) {
        const directory = join(modules, scope!)
        if (!existsSync(directory)) continue
        for (const name of readdirSync(directory)) {
          if (name.startsWith(prefix!) && !name.endsWith(`${native.platform}-${native.arch}`))
            rmSync(join(directory, name), { recursive: true, force: true })
        }
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
