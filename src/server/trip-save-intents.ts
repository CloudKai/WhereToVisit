import "server-only";
import { randomUUID } from "node:crypto";
import type { TripSaveIntent } from "@/shared/contracts";
import { queryCatalogue } from "./catalogue";
import { openDatabase } from "./db/connection";
import { getImport, listImports, resolvedImportPlaces } from "./import-jobs";
import { TripFailure } from "./trips";

function claimSources(
  db: ReturnType<typeof openDatabase>["sqlite"],
  session: string,
  userId: string,
  intent: Pick<TripSaveIntent, "importedEvidence">,
) {
  db.prepare("DELETE FROM imported_source_claims WHERE expires_at<=?").run(
    new Date().toISOString(),
  );
  for (const evidence of intent.importedEvidence) {
    const id = `${session}:${evidence.importId}`;
    const row = db
      .prepare(
        "SELECT organiser_user_id FROM imported_source_claims WHERE id=?",
      )
      .get(id) as { organiser_user_id: string } | undefined;
    if (row && row.organiser_user_id !== userId)
      throw new TripFailure(
        "not-found",
        "This source was already reviewed by another organiser. Start a new import for this account.",
        404,
      );
    db.prepare(
      "INSERT OR IGNORE INTO imported_source_claims(id,organiser_user_id,expires_at) VALUES(?,?,?)",
    ).run(id, userId, new Date(Date.now() + 30 * 86400_000).toISOString());
  }
}
export async function prepareSave(
  session: string,
  userId: string | null,
  placeId: unknown,
  importId: unknown,
) {
  if (
    typeof placeId !== "string" ||
    (importId !== undefined && typeof importId !== "string")
  )
    throw new TripFailure("invalid-request", "Choose a canonical branch.");
  let saved: Pick<TripSaveIntent, "place" | "dataKind" | "importedEvidence">;
  if (typeof importId === "string") {
    const job = getImport(session, importId);
    const resolved =
      job &&
      resolvedImportPlaces([job]).some((item) => item.place.id === placeId)
        ? resolvedImportPlaces(listImports(session)).find(
            (item) =>
              item.place.id === placeId && item.dataKind === job.dataKind,
          )
        : null;
    if (!resolved)
      throw new TripFailure(
        "not-found",
        "Confirmed branch not found in your retained draft.",
        404,
      );
    saved = resolved;
  } else {
    const catalogue = await queryCatalogue({ city: "Shanghai" });
    if (catalogue.status !== "available")
      throw new TripFailure(
        "catalogue-unavailable",
        "The canonical catalogue is unavailable. Retry before saving.",
        503,
      );
    const place = catalogue.data.places.find((item) => item.id === placeId);
    if (!place)
      throw new TripFailure("not-found", "Canonical branch not found.", 404);
    saved = { place, dataKind: catalogue.data.dataKind, importedEvidence: [] };
  }
  if (
    saved.dataKind === "fixture" &&
    !(
      process.env.NODE_ENV === "development" &&
      process.env.ENABLE_DEVELOPMENT_TRIP_FIXTURE === "1"
    )
  )
    throw new TripFailure(
      "fixture-disabled",
      "Fictional Trip saving is not enabled.",
      404,
    );
  if (saved.place.city !== "Shanghai")
    throw new TripFailure(
      "city-not-supported",
      "Shanghai Trips cannot save an out-of-city branch. Your draft confirmation is retained.",
    );
  const intent: TripSaveIntent = {
    id: randomUUID(),
    organiserUserId: userId,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    ...saved,
  };
  const { sqlite } = openDatabase();
  try {
    sqlite.transaction(() => {
      if (userId) claimSources(sqlite, session, userId, intent);
      sqlite
        .prepare("DELETE FROM trip_save_intents WHERE expires_at<=?")
        .run(new Date().toISOString());
      const count = (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM trip_save_intents WHERE session_digest=?",
          )
          .get(session) as { count: number }
      ).count;
      if (count >= 50)
        throw new TripFailure(
          "too-many-intents",
          "You have too many pending saves. Wait for their expiry.",
          429,
        );
      sqlite
        .prepare(
          "INSERT INTO trip_save_intents(id,session_digest,organiser_user_id,document,expires_at) VALUES(?,?,?,?,?)",
        )
        .run(
          intent.id,
          session,
          userId,
          JSON.stringify(intent),
          intent.expiresAt,
        );
    })();
    return intent;
  } finally {
    sqlite.close();
  }
}
export function readSaveIntent(session: string, userId: string, id: string) {
  const { sqlite } = openDatabase();
  try {
    return sqlite.transaction(() => {
      const row = sqlite
        .prepare(
          "SELECT document,organiser_user_id FROM trip_save_intents WHERE id=? AND session_digest=? AND expires_at>?",
        )
        .get(id, session, new Date().toISOString()) as
        | { document: string; organiser_user_id: string | null }
        | undefined;
      if (!row || (row.organiser_user_id && row.organiser_user_id !== userId))
        throw new TripFailure(
          "not-found",
          "Pending save not found for this account and browser. Start a new save.",
          404,
        );
      const intent: TripSaveIntent = JSON.parse(row.document);
      if (
        intent.dataKind === "fixture" &&
        !(
          process.env.NODE_ENV === "development" &&
          process.env.ENABLE_DEVELOPMENT_TRIP_FIXTURE === "1"
        )
      )
        throw new TripFailure("not-found", "Pending save not found.", 404);
      claimSources(sqlite, session, userId, intent);
      intent.organiserUserId = userId;
      sqlite
        .prepare(
          "UPDATE trip_save_intents SET organiser_user_id=?,document=? WHERE id=?",
        )
        .run(userId, JSON.stringify(intent), id);
      return intent;
    })();
  } finally {
    sqlite.close();
  }
}
