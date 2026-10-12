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

export const tripInvitations = sqliteTable("trip_invitations", {
  tripId: text("trip_id")
    .primaryKey()
    .references(() => trips.id, { onDelete: "cascade" }),
  tokenDigest: text("token_digest").notNull().unique(),
  document: text("document").notNull(),
});
export const guestParticipants = sqliteTable(
  "guest_participants",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    document: text("document").notNull(),
  },
  (table) => [index("guest_participants_trip").on(table.tripId)],
);
export const guestSessions = sqliteTable(
  "guest_sessions",
  {
    id: text("id").primaryKey(),
    tokenDigest: text("token_digest").notNull(),
    participantId: text("participant_id")
      .notNull()
      .references(() => guestParticipants.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("guest_sessions_token").on(table.tokenDigest)],
);
