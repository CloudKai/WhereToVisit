import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
export const importSessions = sqliteTable("import_sessions", {
  digest: text("digest").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});
export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    sessionDigest: text("session_digest")
      .notNull()
      .references(() => importSessions.digest, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    document: text("document").notNull(),
  },
  (table) => [
    index("import_jobs_owner").on(table.sessionDigest, table.createdAt),
  ],
);
export const importAttempts = sqliteTable(
  "import_attempts",
  {
    sessionDigest: text("session_digest").notNull(),
    ipDigest: text("ip_digest").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("import_attempts_time").on(table.createdAt)],
);
export const importProviderState = sqliteTable(
  "import_provider_state",
  {
    id: integer("id").primaryKey(),
    backoffUntil: integer("backoff_until").notNull().default(0),
  },
  (table) => [check("single_provider_state", sql`${table.id}=1`)],
);
