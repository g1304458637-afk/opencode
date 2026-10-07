export * as SkillProviders from "./providers"

import { Schema } from "effect"
import { SkillLibrary } from "@opencode-ai/schema/skill-library"
import { SkillArchive } from "./archive"

export interface RegistryProvider {
  discover?(url: string): Promise<readonly SkillLibrary.SourceCandidate[]>
  search(query: string): Promise<readonly SkillLibrary.Candidate[]>
  revision(id: string, revision: string): Promise<SkillLibrary.Candidate>
  resolve(url: string): Promise<SkillLibrary.Candidate>
}
export interface ArtifactProvider {
  download(candidate: SkillLibrary.Candidate): Promise<Uint8Array>
}

export function http(base?: string): { registry: RegistryProvider; artifacts: ArtifactProvider } {
  const endpoint = () => {
    if (!base) throw new Error("Skill Registry is not configured; local import is available")
    const url = new URL(base)
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    )
      throw new Error("Invalid Skill Registry endpoint")
    if (!url.pathname.endsWith("/")) url.pathname += "/"
    return url
  }
  const request = async <A>(resource: string, schema: Schema.Decoder<A>, init?: RequestInit) => {
    const response = await fetch(new URL(resource.replace(/^\/+/, ""), endpoint()), {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      const body = new TextDecoder().decode(await download(response, 8192))
      const detail = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }))(
        JSON.parse(body),
      ).valueOrUndefined
      throw new Error(detail?.error ?? `Skill Registry request failed (${response.status})`)
    }
    return Schema.decodeUnknownSync(schema)(
      JSON.parse(new TextDecoder().decode(await download(response, 4 * 1024 ** 2))),
    )
  }
  return {
    registry: {
      discover: (url) =>
        request("/v1/discover", Schema.Array(SkillLibrary.SourceCandidate), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        }),
      search: (query) => request(`/v1/skills?q=${encodeURIComponent(query)}`, Schema.Array(SkillLibrary.Candidate)),
      revision: (id, revision) =>
        request(
          `/v1/skills/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}`,
          SkillLibrary.Candidate,
        ),
      resolve: (url) =>
        request("/v1/resolve", SkillLibrary.Candidate, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        }),
    },
    artifacts: {
      async download(candidate) {
        const url = new URL(candidate.artifactUrl.replace(/^\/+/, ""), endpoint())
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        if (
          url.username ||
          url.password ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && local && url.origin === endpoint().origin))
        )
          throw new Error("Unsafe skill artifact URL")
        if (/(^|\.)(github\.com|githubusercontent\.com)$/.test(url.hostname))
          throw new Error("Registry artifacts must use the configured artifact service")
        const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120000) })
        if (!response.ok) throw new Error(`Skill download failed (${response.status})`)
        return download(response)
      },
    },
  }
}

export async function download(response: Response, limit = SkillArchive.limits.download) {
  if (!response.body) throw new Error("Empty skill download")
  const length = Number(response.headers.get("content-length"))
  if (length > limit) {
    await response.body.cancel()
    throw new Error("Skill download exceeds limit")
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > limit) throw new Error("Skill download exceeds limit")
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return bytes
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
