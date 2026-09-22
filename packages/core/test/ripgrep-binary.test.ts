import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { LayerNode } from "../src/effect/layer-node"
import { FSUtil } from "../src/fs-util"
import { RipgrepBinary } from "../src/ripgrep/binary"

test("closing the first caller does not poison shared binary initialization", async () => {
  await Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const ready = yield* Deferred.make<void>()
    let checks = 0
    const filesystem = Layer.effect(
      FSUtil.Service,
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        return FSUtil.Service.of({
          ...fs,
          isFile: () =>
            Effect.gen(function* () {
              checks++
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(ready)
              return true
            }),
        })
      }),
    ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
    yield* Effect.gen(function* () {
      const binary = yield* RipgrepBinary.Service
      const first = yield* binary.filepath.pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(first)
      yield* Deferred.succeed(ready, undefined)
      const filepath = yield* binary.filepath
      expect(filepath.length).toBeGreaterThan(0)
      expect(yield* binary.filepath).toBe(filepath)
      expect(checks).toBe(1)
    }).pipe(Effect.provide(LayerNode.compile(RipgrepBinary.node, [[FSUtil.node, filesystem]])))
  }).pipe(Effect.scoped, Effect.runPromise)
})
