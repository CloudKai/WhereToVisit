import { sqliteTable, text } from "drizzle-orm/sqlite-core";
/** Complete publication payloads are atomically replaced after validation. */
export const cataloguePublication = sqliteTable("catalogue_publication", {
  city: text("city").primaryKey(),
  dataKind: text("data_kind", { enum: ["real", "fixture"] }).notNull(),
  payload: text("payload").notNull(),
  loadedAt: text("loaded_at").notNull(),
});
