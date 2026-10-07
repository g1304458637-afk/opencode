import { index, primaryKey, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import type { SkillLibrary } from "@opencode-ai/schema/skill-library"

export const SkillIdentityTable = sqliteTable("skill_identity", {
  id: text().primaryKey(),
  data: text({ mode: "json" }).notNull().$type<SkillLibrary.Identity>(),
})

export const SkillRevisionTable = sqliteTable(
  "skill_revision",
  {
    skill_id: text()
      .notNull()
      .references(() => SkillIdentityTable.id),
    revision: text().notNull(),
    data: text({ mode: "json" }).notNull().$type<SkillLibrary.Revision>(),
  },
  (table) => [primaryKey({ columns: [table.skill_id, table.revision] })],
)

export const SkillInstallationTable = sqliteTable("skill_installation", {
  skill_id: text()
    .primaryKey()
    .references(() => SkillIdentityTable.id),
  revision: text().notNull(),
  installed_at: integer().notNull(),
})

// Owner is the stable submitted/queued message ID, never the changing session selection.
export const SkillReferenceTable = sqliteTable(
  "skill_reference",
  {
    owner: text().notNull(),
    skill_id: text().notNull(),
    revision: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.skill_id] }),
    index("skill_reference_revision_idx").on(table.revision),
  ],
)

export const SkillSelectionTable = sqliteTable("skill_selection", {
  owner: text().primaryKey(),
  refs: text({ mode: "json" }).notNull().$type<readonly SkillLibrary.Reference[]>(),
})

export const SkillOperationTable = sqliteTable("skill_operation", {
  id: text().primaryKey(),
  data: text({ mode: "json" }).notNull().$type<SkillLibrary.Operation>(),
})
