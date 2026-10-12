import "server-only";
import { randomUUID } from "node:crypto";
import type { Trip } from "@/shared/contracts";
import { openDatabase } from "./db/connection";
import { visibleTripDataKind } from "./trip-policy";
export class TripFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function withDatabase<T>(
  operation: (db: ReturnType<typeof openDatabase>["sqlite"]) => T,
) {
  const { sqlite } = openDatabase();
  try {
    return operation(sqlite);
  } finally {
    sqlite.close();
  }
}
export function visibleTrip(trip: Trip) {
  return visibleTripDataKind(trip.dataKind);
}
export function tripInput(title: unknown, city: unknown) {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 120 ||
    city !== "Shanghai"
  )
    throw new TripFailure(
      "invalid-trip",
      "Use a title of 1–120 characters and Shanghai as the Trip city.",
    );
  return { title: title.trim(), city };
}
export function listTrips(userId: string) {
  return withDatabase((db) =>
    (
      db
        .prepare(
          "SELECT document FROM trips WHERE organiser_user_id=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(userId) as { document: string }[]
    )
      .map((row) => JSON.parse(row.document) as Trip)
      .filter(visibleTrip),
  );
}
export function getTrip(userId: string, id: string) {
  return withDatabase((db) => {
    const row = db
      .prepare("SELECT document FROM trips WHERE id=? AND organiser_user_id=?")
      .get(id, userId) as { document: string } | undefined;
    const trip = row ? (JSON.parse(row.document) as Trip) : null;
    return trip && visibleTrip(trip) ? trip : null;
  });
}
export function createTrip(userId: string, title: unknown, city: unknown) {
  const now = new Date().toISOString();
  const trip: Trip = {
    id: randomUUID(),
    organiserUserId: userId,
    ...tripInput(title, city),
    dataKind: "real",
    savedPlaces: [],
    selectedPlaceIds: [],
    dayPlanIds: [],
    createdAt: now,
    updatedAt: now,
  };
  return withDatabase((db) =>
    db.transaction(() => {
      const count = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM trips WHERE organiser_user_id=?",
          )
          .get(userId) as { count: number }
      ).count;
      if (count >= 100)
        throw new TripFailure(
          "too-many-trips",
          "You have reached the limit of 100 private Trips.",
          429,
        );
      db.prepare(
        "INSERT INTO trips(id,organiser_user_id,document) VALUES(?,?,?)",
      ).run(trip.id, userId, JSON.stringify(trip));
      return trip;
    })(),
  );
}
export function changeTrip(
  userId: string,
  id: string,
  change: (trip: Trip) => void,
) {
  return withDatabase((db) =>
    db.transaction(() => {
      const row = db
        .prepare(
          "SELECT document FROM trips WHERE id=? AND organiser_user_id=?",
        )
        .get(id, userId) as { document: string } | undefined;
      const trip = row ? (JSON.parse(row.document) as Trip) : null;
      if (!trip || !visibleTrip(trip))
        throw new TripFailure("not-found", "Private Trip not found.", 404);
      const previousDataKind = trip.dataKind;
      change(trip);
      if (trip.dataKind !== previousDataKind) {
        // A later return to the original kind must never revive an old guest generation.
        db.prepare(
          "UPDATE trip_invitations SET document=json_set(document, '$.state', 'disabled') WHERE trip_id=?",
        ).run(id);
      }
      trip.updatedAt = new Date().toISOString();
      db.prepare(
        "UPDATE trips SET document=? WHERE id=? AND organiser_user_id=?",
      ).run(JSON.stringify(trip), id, userId);
      return trip;
    })(),
  );
}
