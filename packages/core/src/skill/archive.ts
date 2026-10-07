export * as SkillArchive from "./archive"

import path from "node:path"
import { constants } from "node:fs"
import { lstat, open, readdir, mkdir, writeFile, chmod, realpath } from "node:fs/promises"
import { createHash } from "node:crypto"
import { ConfigMarkdown } from "../config/markdown"
import type { SkillLibrary } from "@opencode-ai/schema/skill-library"

export const limits = {
  download: 100 * 1024 ** 2,
  total: 250 * 1024 ** 2,
  file: 25 * 1024 ** 2,
  files: 5000,
  depth: 32,
}
export type Entry = { path: string; bytes: Uint8Array; executable: boolean }
export const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")

export function relative(value: string) {
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  )
    throw new Error("Invalid skill resource path")
  const parts = value.split("/")
  if (
    parts.length > limits.depth ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[:<>"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new Error("Unsafe or non-portable skill resource path")
  return value
}

export function validate(entries: Entry[]) {
  if (entries.length > limits.files) throw new Error("Skill contains too many files")
  const names = new Set<string>()
  const total = entries.reduce((sum, entry) => {
    relative(entry.path)
    const key = entry.path.normalize("NFC").toLowerCase()
    if (names.has(key)) throw new Error("Duplicate or case-conflicting skill paths")
    names.add(key)
    if (entry.bytes.length > limits.file) throw new Error("Skill resource exceeds file size limit")
    return sum + entry.bytes.length
  }, 0)
  if (total > limits.total) throw new Error("Skill exceeds total size limit")
  for (const key of names) {
    const parts = key.split("/")
    if (parts.slice(0, -1).some((_, i) => names.has(parts.slice(0, i + 1).join("/"))))
      throw new Error("Skill file conflicts with a directory")
  }
  const markdown = entries.find((entry) => entry.path === "SKILL.md")
  if (!markdown) throw new Error("Skill root must contain SKILL.md")
  if (markdown.bytes.length > 256 * 1024) throw new Error("SKILL.md exceeds instruction size limit")
  const parsed = ConfigMarkdown.parseOption(new TextDecoder("utf-8", { fatal: true }).decode(markdown.bytes))
  if (!parsed || typeof parsed.data.name !== "string" || !parsed.data.name.trim())
    throw new Error("SKILL.md requires a name")
  if (parsed.data.description !== undefined && typeof parsed.data.description !== "string")
    throw new Error("Invalid skill description")
  const files: SkillLibrary.File[] = entries
    .map((entry) => ({
      path: entry.path,
      hash: hash(entry.bytes),
      size: entry.bytes.length,
      executable: entry.executable,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    files,
    contentHash: hash(JSON.stringify(files)),
  }
}

export async function folder(root: string, manifest?: readonly SkillLibrary.File[]): Promise<Entry[]> {
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink())
    throw new Error("Import must be a real directory")
  const canonical = await realpath(root)
  const entries: Entry[] = []
  let total = 0
  let count = 0
  async function walk(prefix: string): Promise<void> {
    const directory = path.join(canonical, prefix)
    if ((await realpath(directory)) !== directory || (await lstat(directory)).isSymbolicLink())
      throw new Error("Skill directory changed during import")
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++count > limits.files * 2) throw new Error("Skill directory contains too many entries")
      const name = relative(prefix ? `${prefix}/${item.name}` : item.name)
      const absolute = path.join(canonical, name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error("Links and special files are not supported")
      if (stat.isDirectory()) {
        await walk(name)
        continue
      }
      if (stat.nlink > 1) throw new Error("Hard-linked skill resources are not supported")
      if (stat.size > limits.file || total + stat.size > limits.total || entries.length >= limits.files)
        throw new Error("Skill import exceeds size limits")
      const file = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const current = await file.stat()
        if (!current.isFile() || current.ino !== stat.ino || current.size > limits.file)
          throw new Error("Skill resource changed during import")
        const buffer = new Uint8Array(current.size + 1)
        let size = 0
        while (size < buffer.length) {
          const read = await file.read(buffer, size, buffer.length - size, size)
          if (!read.bytesRead) break
          size += read.bytesRead
        }
        const after = await file.stat()
        if (
          size !== current.size ||
          after.size !== current.size ||
          after.mtimeMs !== current.mtimeMs ||
          (await realpath(absolute)) !== absolute
        )
          throw new Error("Skill resource changed during import")
        const bytes = buffer.subarray(0, size)
        total += bytes.length
        if (bytes.length > limits.file || total > limits.total) throw new Error("Skill import exceeds size limits")
        // Windows does not persist POSIX executable bits; locked revisions retain them in the verified manifest.
        const executable =
          process.platform === "win32" && manifest
            ? (manifest.find((entry) => entry.path === name)?.executable ?? false)
            : (current.mode & 0o111) !== 0
        entries.push({ path: name, bytes, executable })
      } finally {
        await file.close()
      }
    }
  }
  await walk("")
  return entries
}

export async function unzip(bytes: Uint8Array): Promise<Entry[]> {
  if (bytes.length > limits.download) throw new Error("Skill archive exceeds download limit")
  const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import("@zip.js/zip.js")
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)), { useWebWorkers: false })
  try {
    const files = await reader.getEntries()
    if (files.length > limits.files + limits.depth) throw new Error("Skill archive contains too many entries")
    const entries: Entry[] = []
    let total = 0
    for (const file of files) {
      relative(file.filename.replace(/\/$/, ""))
      const mode = file.externalFileAttributes >>> 16
      const kind = mode & 0o170000
      if (kind && kind !== 0o100000 && kind !== 0o040000)
        throw new Error("Archive links and special files are not supported")
      if (file.encrypted) throw new Error("Encrypted skill archives are not supported")
      if (file.directory || !file.getData) continue
      if (file.uncompressedSize > limits.file || total + file.uncompressedSize > limits.total)
        throw new Error("Expanded skill archive exceeds limits")
      const data = await file.getData(new Uint8ArrayWriter(), {
        checkSignature: true,
        onprogress: async (size) => {
          if (size > limits.file) throw new Error("Expanded skill file exceeds limit")
        },
      })
      if (!data || data.length !== file.uncompressedSize) throw new Error("Incomplete archive resource")
      total += data.length
      entries.push({ path: file.filename, bytes: data, executable: (mode & 0o111) !== 0 })
    }
    return entries
  } finally {
    await reader.close()
  }
}

export async function write(root: string, entries: Entry[]) {
  validate(entries)
  for (const entry of entries) {
    const target = path.join(root, relative(entry.path))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, entry.bytes, { flag: "wx", mode: entry.executable ? 0o755 : 0o644 })
    await chmod(target, entry.executable ? 0o755 : 0o644)
  }
}
