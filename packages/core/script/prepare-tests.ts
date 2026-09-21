import { Effect } from "effect"
import { LayerNode } from "../src/effect/layer-node"
import { RipgrepBinary } from "../src/ripgrep/binary"

// Download and extract tools before per-test deadlines start on cold CI runners.
await Effect.gen(function* () {
  const binary = yield* RipgrepBinary.Service
  console.log(`Prepared ripgrep: ${yield* binary.filepath}`)
}).pipe(Effect.provide(LayerNode.compile(RipgrepBinary.node)), Effect.scoped, Effect.runPromise)
