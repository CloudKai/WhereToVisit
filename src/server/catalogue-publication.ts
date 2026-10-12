import { readFileSync } from "node:fs";
import type { CatalogueBatch } from "../shared/contracts";
import { validateCatalogueBatch } from "./catalogue-validation";
import { openDatabase } from "./db/connection";

/** Explicit source import and development scenarios share this atomic load. */
export function loadCatalogueFile(filename: string, allowFixture = false) {
  const batch = validateCatalogueBatch(
    JSON.parse(readFileSync(filename, "utf8")),
  );
  if (batch.kind === "fixture" && !allowFixture)
    throw new Error("Fixture publications are forbidden in this environment.");
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
