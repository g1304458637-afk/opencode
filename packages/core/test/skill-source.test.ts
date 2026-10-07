import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SkillSource } from "../src/skill/source"

test("GitHub API uses the server token without exposing it in request errors", async () => {
  const authorization: Array<string | null> = []
  const result = await SkillSource.api("/repos/example/skills", Schema.Struct({ ok: Schema.Boolean }), {
    token: "server-only-token",
    fetch: async (input, init) => {
      authorization.push(new Request(input, init).headers.get("authorization"))
      return Response.json({ ok: true })
    },
  })

  expect(authorization[0]).toBe("Bearer server-only-token")
  expect(result).toEqual({ ok: true })
})

test("GitHub API reports its retry window when the upstream rate limit is exhausted", async () => {
  const response = new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
    status: 403,
    headers: { "x-ratelimit-remaining": "0", "retry-after": "37" },
  })

  await expect(
    SkillSource.api("/repos/example/skills", Schema.Struct({ ok: Schema.Boolean }), {
      token: "server-only-token",
      fetch: async () => response,
    }),
  ).rejects.toMatchObject({
    name: "GitHubSourceError",
    status: 403,
    rateLimited: true,
    retryAfterSeconds: 37,
    message: "GitHub is temporarily rate limiting Skill Registry requests",
  })
})
