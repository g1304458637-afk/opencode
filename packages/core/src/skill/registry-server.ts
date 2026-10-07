export * as SkillRegistryServer from "./registry-server"

import path from "node:path"
import { mkdir, readFile, writeFile, rename, readdir, statfs } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { Schema } from "effect"
import { SkillLibrary } from "@opencode-ai/schema/skill-library"
import { SkillSource } from "./source"
import { SkillArchive } from "./archive"
import { Flock } from "../util/flock"

// Real filesystem-backed development registry; usable behind a production HTTPS/CDN gateway.
// It never executes fetched content. Upstream resolution is restricted to operator-listed repositories.
export function create(
  root: string,
  repositories?: readonly string[],
  upstream: Pick<typeof SkillSource, "discover" | "github"> = SkillSource,
) {
  const allowed = new Set((repositories ?? []).map((name) => name.toLowerCase()))
  const upstreamCache = new Map<string, { expiresAt: number; result: Promise<unknown> }>()
  let githubRetryAt = 0
  const manifest = (id: string, revision: string) => path.join(root, "index", `${id}-${revision}.json`)
  const fromUpstream = <A>(key: string, load: () => Promise<A>) => {
    const now = Date.now()
    if (githubRetryAt > now)
      throw new SkillSource.GitHubSourceError(429, true, Math.max(1, Math.ceil((githubRetryAt - now) / 1000)))
    const cached = upstreamCache.get(key)
    if (cached && cached.expiresAt > now) return cached.result as Promise<A>
    for (const [entry, value] of upstreamCache) {
      if (value.expiresAt <= now) upstreamCache.delete(entry)
    }
    if (upstreamCache.size >= 256) upstreamCache.delete(upstreamCache.keys().next().value!)
    const result = load().catch((cause) => {
      if (upstreamCache.get(key)?.result === result) upstreamCache.delete(key)
      if (cause instanceof SkillSource.GitHubSourceError && cause.rateLimited && cause.retryAfterSeconds)
        githubRetryAt = Math.max(githubRetryAt, Date.now() + cause.retryAfterSeconds * 1000)
      throw cause
    })
    upstreamCache.set(key, { expiresAt: now + 5 * 60 * 1000, result })
    return result
  }
  const ensureSpace = async (bytes = 0) => {
    await mkdir(root, { recursive: true })
    const space = await statfs(root)
    // Cached revisions remain readable when upstream publication is paused for disk pressure.
    if (space.bavail * space.bsize < 512 * 1024 ** 2 + bytes)
      throw new Error("Skill Registry storage is temporarily unavailable; cached revisions remain available")
  }
  const publish = async (source: {
    identity: SkillLibrary.Identity
    entries: SkillArchive.Entry[]
    upstreamRevision?: string
  }) => {
    const checked = SkillArchive.validate(source.entries)
    const bytes = await SkillSource.zip(source.entries)
    await ensureSpace(bytes.length)
    const artifactHash = SkillArchive.hash(bytes)
    const candidate: SkillLibrary.Candidate = {
      ...source.identity,
      revision: checked.contentHash,
      contentHash: checked.contentHash,
      artifactHash,
      artifactUrl: `/v1/artifacts/${artifactHash}.zip`,
      upstreamRevision: source.upstreamRevision,
    }
    await mkdir(path.join(root, "artifacts"), { recursive: true })
    await mkdir(path.join(root, "index"), { recursive: true })
    const temporary = path.join(root, `publish-${randomUUID()}`)
    await writeFile(temporary, bytes)
    await rename(temporary, path.join(root, "artifacts", `${artifactHash}.zip`))
    await writeFile(`${temporary}.json`, JSON.stringify(candidate))
    await rename(`${temporary}.json`, manifest(candidate.id, candidate.revision))
    await writeFile(`${temporary}.json`, JSON.stringify(candidate))
    await rename(`${temporary}.json`, path.join(root, "index", `current-${candidate.id}.json`))
    return candidate
  }
  const resolve = async (url: string) => {
    const source = SkillSource.parse(url)
    if (repositories && !allowed.has(source.repository))
      throw new Error(
        "Upstream repository is not enabled on this Registry; local import or explicitly configured direct fallback is available",
      )
    // An exact commit can be served indefinitely from its validated artifact manifest.
    if (/^[a-f0-9]{40}$/.test(source.ref)) {
      const files = await readdir(path.join(root, "index")).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return []
        throw cause
      })
      for (const file of files.filter((file) => /^sk_[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(file))) {
        const candidate = Schema.decodeUnknownSync(SkillLibrary.Candidate)(
          JSON.parse(await readFile(path.join(root, "index", file), "utf8")),
        )
        if (
          candidate.repository === source.repository &&
          candidate.path === source.path &&
          candidate.upstreamRevision === source.ref
        )
          return candidate
      }
    }
    return fromUpstream(JSON.stringify(["resolve", source.repository, source.ref, source.path]), async () => {
      const lock = await Flock.acquire("upstream", { dir: path.join(root, "locks"), timeoutMs: 5000 })
      try {
        await ensureSpace()
        return await publish(await upstream.github(url))
      } finally {
        await lock.release()
      }
    })
  }
  const discover = async (url: string) => {
    const source = SkillSource.parse(url)
    if (repositories && !allowed.has(source.repository)) throw new Error("Repository is not enabled")
    const key = (ref: string) =>
      path.join(root, "discovery", `${SkillArchive.hash(JSON.stringify([source.repository, ref, source.path]))}.json`)
    if (/^[a-f0-9]{40}$/.test(source.ref)) {
      const saved = await readFile(key(source.ref), "utf8").catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return undefined
        throw cause
      })
      if (saved) return Schema.decodeUnknownSync(Schema.Array(SkillLibrary.SourceCandidate))(JSON.parse(saved))
    }
    return fromUpstream(JSON.stringify(["discover", source.repository, source.ref, source.path]), async () => {
      await ensureSpace()
      const result = await upstream.discover(url)
      await mkdir(path.join(root, "discovery"), { recursive: true })
      const temporary = path.join(root, "discovery", `${randomUUID()}.tmp`)
      await writeFile(temporary, JSON.stringify(result))
      await rename(temporary, key(result[0].upstreamRevision))
      return result
    })
  }
  const search = async (query: string) => {
    const files = await readdir(path.join(root, "index")).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return []
      throw cause
    })
    const found: SkillLibrary.Candidate[] = []
    const heads = new Set(files.flatMap((file) => /^current-(sk_[a-f0-9]{64})\.json$/.exec(file)?.slice(1) ?? []))
    for (const file of files) {
      const current = /^current-(sk_[a-f0-9]{64})\.json$/.test(file)
      const historical = /^(sk_[a-f0-9]{64})-[a-f0-9]{64}\.json$/.exec(file)
      if (!current && (!historical || heads.has(historical[1]))) continue
      const candidate = Schema.decodeUnknownSync(SkillLibrary.Candidate)(
        JSON.parse(await readFile(path.join(root, "index", file), "utf8")),
      )
      if (
        `${candidate.name} ${candidate.description} ${candidate.repository}`.toLowerCase().includes(query.toLowerCase())
      )
        found.push(candidate)
    }
    // Search advertises one current revision per identity; immutable old manifests remain addressable.
    return found.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id) || a.revision.localeCompare(b.revision),
    )
  }
  const fetch = async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/v1/skills")
        return Response.json(await search((url.searchParams.get("q") ?? "").slice(0, 256)))
      const revision = /^\/v1\/skills\/(sk_[a-f0-9]{64})\/revisions\/([a-f0-9]{64})$/.exec(url.pathname)
      if (request.method === "GET" && revision)
        return Response.json(
          Schema.decodeUnknownSync(SkillLibrary.Candidate)(
            JSON.parse(await readFile(manifest(revision[1], revision[2]), "utf8")),
          ),
        )
      const artifact = /^\/v1\/artifacts\/([a-f0-9]{64})\.zip$/.exec(url.pathname)
      if (request.method === "GET" && artifact)
        return new Response(await readFile(path.join(root, "artifacts", `${artifact[1]}.zip`)), {
          headers: { "content-type": "application/zip", "cache-control": "public, max-age=31536000, immutable" },
        })
      if (request.method === "POST" && ["/v1/resolve", "/v1/discover"].includes(url.pathname)) {
        if (Number(request.headers.get("content-length")) > 8192)
          return Response.json({ error: "Request too large" }, { status: 413 })
        const text = await request.text()
        if (text.length > 8192) return Response.json({ error: "Request too large" }, { status: 413 })
        const input = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(JSON.parse(text))
        return Response.json(await (url.pathname === "/v1/discover" ? discover(input.url) : resolve(input.url)))
      }
      return Response.json({ error: "Not found" }, { status: 404 })
    } catch (cause) {
      const upstreamError = cause instanceof SkillSource.GitHubSourceError ? cause : undefined
      return Response.json(
        { error: cause instanceof Error ? cause.message : "Registry request failed" },
        {
          status: upstreamError ? (upstreamError.rateLimited ? 503 : 502) : 400,
          headers: {
            "cache-control": "no-store",
            ...(upstreamError?.retryAfterSeconds ? { "retry-after": String(upstreamError.retryAfterSeconds) } : {}),
          },
        },
      )
    }
  }
  return { fetch, resolve, discover, search, publish }
}
