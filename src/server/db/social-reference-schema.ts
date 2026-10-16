import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { importSessions } from "./import-schema";
export const socialReferences = sqliteTable(
  "social_references",
  {
    id: text("id").primaryKey(),
    sessionDigest: text("session_digest")
      .notNull()
      .references(() => importSessions.digest, { onDelete: "cascade" }),
    branchId: text("branch_id"),
    choiceRevision: integer("choice_revision").notNull().default(0),
    platform: text("platform").notNull(),
    sourceUrl: text("source_url").notNull(),
    note: text("note").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("social_references_owner").on(table.sessionDigest, table.createdAt),
    index("social_references_expiry").on(table.expiresAt),
  ],
);
export const socialReferenceAttempts = sqliteTable(
  "social_reference_attempts",
  {
    sessionDigest: text("session_digest").notNull(),
    ipDigest: text("ip_digest").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("social_reference_attempts_time").on(table.createdAt)],
);
