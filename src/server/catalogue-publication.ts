import { readFileSync } from "node:fs";
import type { CatalogueBatch, Trip } from "../shared/contracts";
import { readReviewedPhoto } from "./branch-photo";
import { validateCatalogueBatch } from "./catalogue-validation";
import { openDatabase } from "./db/connection";
import { refreshTripVisitFacts } from "./visit-facts";

/** Explicit source import and development scenarios share this atomic load. */
export function loadCatalogueFile(filename: string, allowFixture = false) {
  const batch = validateCatalogueBatch(
    JSON.parse(readFileSync(filename, "utf8")),
  );
  if (batch.kind === "fixture" && !allowFixture)
    throw new Error("Fixture publications are forbidden in this environment.");
  // Validate the licensed original before opening a transaction or replacing anything.
  for (const place of batch.places)
    if (place.photo) readReviewedPhoto(place.photo.assetId);
  const { sqlite } = openDatabase();
  try {
    sqlite.transaction(() => {
      sqlite
        .prepare(
          "INSERT INTO catalogue_publication (city, data_kind, payload, loaded_at) VALUES (?, ?, ?, ?) ON CONFLICT(city) DO UPDATE SET data_kind=excluded.data_kind, payload=excluded.payload, loaded_at=excluded.loaded_at",
        )
        .run(
          batch.city,
          batch.kind,
          JSON.stringify(batch),
          new Date().toISOString(),
        );
      // Source maintenance is internal; refresh only the matching retained data kind.
      const rows = sqlite.prepare("SELECT id, document FROM trips").all() as {
        id: string;
        document: string;
      }[];
      for (const row of rows) {
        const trip = JSON.parse(row.document) as Trip;
        if (trip.dataKind !== batch.kind) continue;
        refreshTripVisitFacts(trip, batch);
        sqlite
          .prepare("UPDATE trips SET document=? WHERE id=?")
          .run(JSON.stringify(trip), row.id);
      }
    })();
  } finally {
    sqlite.close();
  }
}
export function readCataloguePublication(): CatalogueBatch | null {
  const { sqlite } = openDatabase();
  try {
    const row = sqlite
      .prepare("SELECT payload FROM catalogue_publication WHERE city = ?")
      .get("Shanghai") as { payload: string } | undefined;
    return row ? validateCatalogueBatch(JSON.parse(row.payload)) : null;
  } finally {
    sqlite.close();
  }
}
