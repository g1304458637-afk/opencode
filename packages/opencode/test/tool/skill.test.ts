import { SkillLibrary } from "@opencode-ai/core/skill/library"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  LayerNode.compile(LayerNode.group([ToolRegistry.node, SkillLibrary.node, CrossSpawnSpawner.node, Ripgrep.node])),
)

describe("tool.skill", () => {
  it.instance("execute returns skill content block with files", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const skill = path.join(dir, ".opencode", "skill", "tool-skill")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(skill, "SKILL.md"),
          `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
`,
        ),
      )
      yield* Effect.promise(() => Bun.write(path.join(skill, "scripts", "demo.txt"), "demo"))

      const home = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = dir
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.env.OPENCODE_TEST_HOME = home
        }),
      )

      const registry = yield* ToolRegistry.Service
      const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
      const tool = (yield* registry.tools({
        providerID: "opencode" as any,
        modelID: "gpt-5" as any,
        agent,
      })).find((tool) => tool.id === SkillTool.id)
      if (!tool) throw new Error("Skill tool not found")

      expect(tool.description).not.toContain("tool-skill")
      expect(tool.description).not.toContain("Skill for tool tests.")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const ctx: Tool.Context = {
        ...baseCtx,
        ask: (req) =>
          Effect.sync(() => {
            requests.push(req)
          }),
      }

      const result = yield* tool.execute({ name: "tool-skill" }, ctx)
      const file = path.resolve(skill, "scripts", "demo.txt")

      expect(requests.length).toBe(1)
      expect(requests[0].permission).toBe("skill")
      expect(requests[0].patterns).toContain("tool-skill")
      expect(requests[0].always).toContain("tool-skill")
      expect(result.metadata.dir).toBe(skill)
      expect(result.output).toContain(`<skill_content name="tool-skill">`)
      expect(result.output).toContain(`Base directory for this skill: ${skill}`)
      expect(result.output).toContain(`<file>${file}</file>`)
    }),
  )

  it.instance("execute preserves not found message", () =>
    Effect.gen(function* () {
      const dir = (yield* TestInstance).directory
      const home = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = dir
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.env.OPENCODE_TEST_HOME = home
        }),
      )

      const registry = yield* ToolRegistry.Service
      const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
      const tool = (yield* registry.tools({
        providerID: "opencode" as any,
        modelID: "gpt-5" as any,
        agent,
      })).find((tool) => tool.id === SkillTool.id)
      if (!tool) throw new Error("Skill tool not found")

      const exit = yield* tool
        .execute(
          { name: "missing-skill" },
          {
            ...baseCtx,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(Error)
        if (error instanceof Error) expect(error.message).toContain('Skill "missing-skill" not found.')
      }
    }),
  )
  it.instance("HUBU selected skills still enforce skill permission before exposing resources", () =>
    Effect.gen(function* () {
      const previousBrand = process.env.BRAND
      process.env.BRAND = "hubu"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previousBrand === undefined) delete process.env.BRAND
          else process.env.BRAND = previousBrand
        }),
      )
      const library = yield* SkillLibrary.Service
      const identity = {
        sourceType: "local" as const,
        repository: "skill-permission-test",
        path: "",
        name: "selected-skill",
        description: "",
      }
      const installed = yield* library
        .importEntries({ ...identity, id: SkillLibrary.identity(identity) }, [
          {
            path: "SKILL.md",
            bytes: new TextEncoder().encode("---\nname: selected-skill\n---\nLocked instructions"),
            executable: false,
          },
        ])
        .pipe(Effect.orDie)
      const registry = yield* ToolRegistry.Service
      const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
      const tool = (yield* registry.tools({
        providerID: ProviderV2.ID.make("sub2api"),
        modelID: ModelV2.ID.make("fixture"),
        agent,
      })).find((tool) => tool.id === SkillTool.id)
      if (!tool) throw new Error("Skill tool not found")
      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const ctx: Omit<Tool.Context, "ask"> = {
        ...baseCtx,
        messages: [
          {
            info: {
              id: baseCtx.messageID,
              sessionID: baseCtx.sessionID,
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: { providerID: ProviderV2.ID.make("sub2api"), modelID: ModelV2.ID.make("fixture") },
              selectedSkills: [
                { skillId: installed.id, revision: installed.revision, contentHash: installed.contentHash },
              ],
            },
            parts: [],
          },
        ],
      }
      const denied = yield* tool
        .execute(
          { name: identity.name },
          {
            ...ctx,
            ask: (request) =>
              Effect.sync(() => {
                requests.push(request)
              }).pipe(Effect.andThen(Effect.die(new Error("Permission denied by fixture")))),
          },
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(denied)).toBe(true)
      if (Exit.isFailure(denied)) expect(String(Cause.squash(denied.cause))).toContain("Permission denied by fixture")
      const allowed = yield* tool.execute(
        { name: identity.name },
        {
          ...ctx,
          ask: (request) =>
            Effect.sync(() => {
              requests.push(request)
            }),
        },
      )
      expect(requests).toHaveLength(2)
      expect(
        requests.every((request) => request.permission === "skill" && request.patterns.includes(identity.name)),
      ).toBe(true)
      expect(allowed.metadata.name).toBe(identity.name)
      expect(allowed.output).toContain("already loaded for this task")
    }),
  )
})
