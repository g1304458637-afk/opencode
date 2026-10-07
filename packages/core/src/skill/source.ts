export * as SkillSource from "./source"

import { resolveBrand } from "@opencode-ai/brand"
import { Schema } from "effect"
import { createHash } from "node:crypto"
import { SkillArchive } from "./archive"
import { download, identity } from "./library"

const Commit = Schema.Struct({
  sha: Schema.String,
  commit: Schema.Struct({ tree: Schema.Struct({ sha: Schema.String }) }),
})
const Tree = Schema.Struct({
  truncated: Schema.Boolean,
  tree: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      mode: Schema.String,
      type: Schema.String,
      sha: Schema.String,
      size: Schema.optional(Schema.Number),
    }),
  ),
})
const Blob = Schema.Struct({ encoding: Schema.String, content: Schema.String, size: Schema.Number })

export class GitHubSourceError extends Error {
  constructor(
    readonly status: number,
    readonly rateLimited: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      rateLimited
        ? "GitHub is temporarily rate limiting Skill Registry requests"
        : `GitHub source request failed (${status})`,
    )
    this.name = "GitHubSourceError"
  }
}

export async function api<A>(
  url: string,
  schema: Schema.Decoder<A>,
  options: { token?: string; fetch?: (input: string, init: RequestInit) => Promise<Response> } = {},
) {
  const headers = new Headers({
    accept: "application/vnd.github+json",
    "user-agent": `${resolveBrand().id}-Skill-Registry`,
    "x-github-api-version": "2022-11-28",
  })
  const brand = resolveBrand()
  const token =
    options.token ??
    (brand.id === "hubu"
      ? process.env.HUBU_SKILL_GITHUB_TOKEN
      : brand.id === "kai"
        ? process.env.KCODE_SKILL_GITHUB_TOKEN
        : undefined)
  if (token?.trim()) headers.set("authorization", `Bearer ${token.trim()}`)
  const request = options.fetch ?? ((input, init) => fetch(input, init))
  const response = await request(`https://api.github.com${url}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"))
    const remaining = response.headers.get("x-ratelimit-remaining")
    const reset = Number(response.headers.get("x-ratelimit-reset"))
    const details = await response
      .clone()
      .json()
      .catch(() => undefined)
    const message = details && typeof details === "object" && "message" in details ? String(details.message) : ""
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 &&
        (remaining === "0" || retryAfter > 0 || /secondary rate limit|abuse detection/i.test(message)))
    const resetDelay = Number.isFinite(reset) && reset > 0 ? Math.ceil(reset - Date.now() / 1000) : 0
    throw new GitHubSourceError(
      response.status,
      rateLimited,
      rateLimited
        ? Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter
          : resetDelay > 0
            ? resetDelay
            : 60
        : undefined,
    )
  }
  return Schema.decodeUnknownSync(schema)(
    JSON.parse(new TextDecoder().decode(await download(response, 40 * 1024 ** 2))),
  )
}

export function parse(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new Error("Use a public HTTPS GitHub repository or skill directory URL")
  const parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent)
  if (parts.length < 2 || parts.slice(0, 2).some((part) => !/^[\w.-]+$/.test(part)))
    throw new Error("Invalid GitHub repository")
  const repository = `${parts[0].toLowerCase()}/${parts[1].replace(/\.git$/, "").toLowerCase()}`
  if (parts.length === 2) return { repository, ref: "HEAD", path: "" }
  if (!["tree", "blob"].includes(parts[2]) || !parts[3] || parts[3].includes("/"))
    throw new Error("Use a GitHub tree URL with a branch or commit and skill directory")
  if (parts[2] === "blob" && parts.at(-1) !== "SKILL.md") throw new Error("Use a SKILL.md file link")
  const directory = (parts[2] === "blob" ? parts.slice(4, -1) : parts.slice(4)).join("/")
  if (directory) SkillArchive.relative(directory)
  return { repository, ref: parts[3], path: directory }
}

// Enumerate only paths present in Git's immutable tree. Never infer a skill directory.
export async function discover(url: string) {
  const source = parse(url)
  const commit = await api(`/repos/${source.repository}/commits/${encodeURIComponent(source.ref)}`, Commit)
  if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit.tree.sha))
    throw new Error("Invalid source commit")
  const tree = await api(`/repos/${source.repository}/git/trees/${commit.commit.tree.sha}?recursive=1`, Tree)
  if (tree.truncated) throw new Error("Source tree is truncated; use a smaller repository")
  const prefix = source.path ? `${source.path}/` : ""
  const found = tree.tree.filter(
    (file) =>
      file.type === "blob" &&
      ["100644", "100755"].includes(file.mode) &&
      file.path.startsWith(prefix) &&
      (file.path === "SKILL.md" || file.path.endsWith("/SKILL.md")),
  )
  if (!found.length) throw new Error("No SKILL.md found at this source")
  if (found.length > 500) throw new Error("Too many skills; use a more specific directory")
  // A directory with its own SKILL.md denotes that skill; repository roots always enumerate all skills.
  const exact = source.path && found.find((file) => file.path === `${prefix}SKILL.md`)
  return (exact ? [exact] : found)
    .map((file) => {
      const directory = file.path === "SKILL.md" ? "" : file.path.slice(0, -"/SKILL.md".length)
      if (directory) SkillArchive.relative(directory)
      return {
        repository: source.repository,
        path: directory,
        upstreamRevision: commit.sha,
        url: `https://github.com/${source.repository}/tree/${commit.sha}${directory ? `/${directory.split("/").map(encodeURIComponent).join("/")}` : ""}`,
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

export async function github(url: string) {
  const source = parse(url)
  const commit = await api(`/repos/${source.repository}/commits/${encodeURIComponent(source.ref)}`, Commit)
  if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit.tree.sha))
    throw new Error("Invalid source commit")
  const tree = await api(`/repos/${source.repository}/git/trees/${commit.commit.tree.sha}?recursive=1`, Tree)
  if (tree.truncated) throw new Error("Source tree is truncated; use a smaller repository")
  const prefix = source.path ? `${source.path}/` : ""
  const files = tree.tree.filter((item) => item.path.startsWith(prefix) && item.type !== "tree")
  if (!files.length || files.length > SkillArchive.limits.files)
    throw new Error("Skill source has no files or exceeds the file limit")
  if (files.some((file) => !["100644", "100755"].includes(file.mode) || !/^[a-f0-9]{40}$/.test(file.sha)))
    throw new Error("Linked resources and submodules are not supported")
  if (
    files.some((file) => (file.size ?? 0) > SkillArchive.limits.file) ||
    files.reduce((size, file) => size + (file.size ?? 0), 0) > SkillArchive.limits.total
  )
    throw new Error("Skill source exceeds size limits")
  const entries: SkillArchive.Entry[] = []
  for (const file of files) {
    const name = SkillArchive.relative(file.path.slice(prefix.length))
    const blob = await api(`/repos/${source.repository}/git/blobs/${file.sha}`, Blob)
    if (blob.encoding !== "base64") throw new Error("Unsupported source encoding")
    const bytes = Buffer.from(blob.content, "base64")
    if (bytes.length !== blob.size || bytes.length !== file.size) throw new Error("Incomplete source resource")
    const checksum = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
    if (checksum !== file.sha) throw new Error("Source resource checksum mismatch")
    entries.push({ path: name, bytes, executable: file.mode === "100755" })
  }
  const checked = SkillArchive.validate(entries)
  const provenance = { sourceType: "github" as const, repository: source.repository, path: source.path }
  return {
    entries,
    identity: { ...provenance, id: identity(provenance), name: checked.name, description: checked.description },
    upstreamRevision: commit.sha,
  }
}

export async function zip(entries: SkillArchive.Entry[]) {
  SkillArchive.validate(entries)
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = await import("@zip.js/zip.js")
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    await writer.add(entry.path, new Uint8ArrayReader(entry.bytes), {
      useWebWorkers: false,
      lastModDate: new Date("2000-01-01T00:00:00Z"),
      externalFileAttributes: (entry.executable ? 0o100755 : 0o100644) << 16,
      msDosCompatible: false,
    })
  }
  return writer.close()
}
