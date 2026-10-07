import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261004045527_skill_library",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`skill_identity\` (
          \`id\` text PRIMARY KEY,
          \`data\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`skill_installation\` (
          \`skill_id\` text PRIMARY KEY,
          \`revision\` text NOT NULL,
          \`installed_at\` integer NOT NULL,
          CONSTRAINT \`fk_skill_installation_skill_id_skill_identity_id_fk\` FOREIGN KEY (\`skill_id\`) REFERENCES \`skill_identity\`(\`id\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`skill_operation\` (
          \`id\` text PRIMARY KEY,
          \`data\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`skill_reference\` (
          \`owner\` text NOT NULL,
          \`skill_id\` text NOT NULL,
          \`revision\` text NOT NULL,
          CONSTRAINT \`skill_reference_pk\` PRIMARY KEY(\`owner\`, \`skill_id\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`skill_revision\` (
          \`skill_id\` text NOT NULL,
          \`revision\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`skill_revision_pk\` PRIMARY KEY(\`skill_id\`, \`revision\`),
          CONSTRAINT \`fk_skill_revision_skill_id_skill_identity_id_fk\` FOREIGN KEY (\`skill_id\`) REFERENCES \`skill_identity\`(\`id\`)
        );
      `)
      yield* tx.run(`CREATE INDEX \`skill_reference_revision_idx\` ON \`skill_reference\` (\`revision\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
