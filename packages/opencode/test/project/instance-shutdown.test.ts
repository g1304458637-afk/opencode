import { test, expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { tmpdir } from "../fixture/fixture"

test.each(["load", "reload"] as const)(
  "service shutdown interrupts an in-flight %s",
  async (operation) => {
    await using dir = await tmpdir({ git: true })
    const started = Deferred.makeUnsafe<void>()
    const interrupted = Deferred.makeUnsafe<void>()
    const scope = Scope.makeUnsafe()
    let block = operation === "load"
    const layer = LayerNode.compile(InstanceStore.node, [
      [
        InstanceStore.bootstrapNode,
        Layer.succeed(InstanceBootstrap.Service, {
          run: Effect.suspend(() =>
            block
              ? Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                )
              : Effect.void,
          ),
        }),
      ],
    ])
    const context = await Effect.runPromise(Layer.buildWithMemoMap(layer, Layer.makeMemoMapUnsafe(), scope))
    const store = Context.get(context, InstanceStore.Service)
    if (operation === "reload") {
      await Effect.runPromise(store.load({ directory: dir.path }))
      block = true
    }
    const waiting = Effect.runFork(store[operation]({ directory: dir.path }))
    await Effect.runPromise(Deferred.await(started))
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(Exit.isFailure(await Effect.runPromise(Fiber.await(waiting)))).toBe(true)
    expect(await Effect.runPromise(Deferred.isDone(interrupted))).toBe(true)
  },
  5_000,
)
