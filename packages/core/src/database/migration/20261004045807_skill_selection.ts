import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261004045807_skill_selection",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`skill_selection\` (
          \`owner\` text PRIMARY KEY,
          \`refs\` text NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
