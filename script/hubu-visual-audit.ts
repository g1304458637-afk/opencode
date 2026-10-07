#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { lstat, readlink } from "node:fs/promises"
import { resolve } from "node:path"

// Compare source bytes with the approved HUBU baseline, including audio and motion
// controllers. Screenshots complement this audit; they cannot prove animation timing.
const baseline = process.argv[2] ?? "34e49bc7768eef157ed5d78de9c1aecee73c898d"
const root = resolve(import.meta.dir, "..")
function git(args: string[]) {
  const result = Bun.spawnSync(["git", "-c", `safe.directory=${root}`, ...args], { cwd: root })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout
}
const files = git(["ls-tree", "-r", "-z", baseline])
  .toString()
  .split("\0")
  .filter(Boolean)
  .map((entry) => {
    const [metadata, file] = entry.split("\t")
    return { file, blob: metadata.split(" ")[2] }
  })
const protectedFiles = files.filter(
  ({ file }) =>
    (/^packages\/(app|ui|session-ui|desktop)\//.test(file) &&
      /\.(css|png|jpe?g|webp|svg|gif|ico|icns|mp4|webm|mp3|aac|wav|woff2?)$/.test(file)) ||
    /^packages\/desktop\/src\/(renderer|shared)\/.*(reward|quota-energy|reset-animation)/.test(file) ||
    /^packages\/ui\/src\/components\/motion-/.test(file) ||
    file === "packages/app/src/pages/session/message-timeline.tsx",
)
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex")
const results = await Promise.all(
  protectedFiles.map(async ({ file, blob }) => {
    const target = resolve(root, file)
    const bytes = await lstat(target)
      .then(async (stat) =>
        stat.isSymbolicLink()
          ? new TextEncoder().encode((await readlink(target)).replaceAll("\\", "/"))
          : Bun.file(target).bytes(),
      )
      .catch(() => undefined)
    const currentBlob = bytes && createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
    return { file, baselineBlob: blob, sha256: bytes ? hash(bytes) : "missing", unchanged: blob === currentBlob }
  }),
)
const changed = results.filter((result) => !result.unchanged)
console.log(JSON.stringify({ baseline, checked: results.length, changed, files: results }, null, 2))
if (changed.length) process.exitCode = 1
