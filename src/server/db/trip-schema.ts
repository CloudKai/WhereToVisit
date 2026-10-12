import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
export const trips = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey(),
    organiserUserId: text("organiser_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    document: text("document").notNull(),
  },
  (table) => [index("trips_owner").on(table.organiserUserId)],
);
export const tripSaveIntents = sqliteTable("trip_save_intents", {
  id: text("id").primaryKey(),
  sessionDigest: text("session_digest").notNull(),
  organiserUserId: text("organiser_user_id").references(() => user.id, {
    onDelete: "cascade",
  }),
  document: text("document").notNull(),
  expiresAt: text("expires_at").notNull(),
});
export const importedSourceClaims = sqliteTable("imported_source_claims", {
  id: text("id").primaryKey(),
  organiserUserId: text("organiser_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
});
