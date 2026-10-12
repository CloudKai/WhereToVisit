import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  GuestParticipant,
  InvitationManagement,
  SharedGuestTrip,
  Trip,
  TripInvitation,
} from "@/shared/contracts";
import { getAuthConfiguration } from "./config";
import { dayPlanState } from "./day-plan-state";
import { openDatabase } from "./db/connection";
import {
  generatedDayPlanState,
  projectedDayPlanIds,
} from "./generated-day-plan-state";
import { TripFailure, visibleTrip } from "./trips";

type Database = ReturnType<typeof openDatabase>["sqlite"];
type InvitationRecord = Omit<TripInvitation, "url"> & {
  dataKind: Trip["dataKind"];
};
type ParticipantRecord = Omit<GuestParticipant, "accessActive"> & {
  generation: string;
  dataKind: Trip["dataKind"];
};
export const GUEST_COOKIE = "wheretovisit_guest";
export const GUEST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export function guestToken(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function transaction<T>(operation: (db: Database) => T) {
  const { sqlite } = openDatabase();
  try {
    return sqlite.transaction(() => operation(sqlite))();
  } finally {
    sqlite.close();
  }
}
function unavailable(): never {
  throw new TripFailure(
    "guest-access-unavailable",
    "Guest access is unavailable. The link may have been disabled or replaced, or your browser session expired. Ask the organiser for a current invitation.",
    404,
  );
}
function storedTrip(db: Database, id: string) {
  const row = db.prepare("SELECT document FROM trips WHERE id=?").get(id) as
    | { document: string }
    | undefined;
  const trip = row ? (JSON.parse(row.document) as Trip) : null;
  return trip && visibleTrip(trip) ? trip : null;
}
function ownedTrip(db: Database, userId: string, id: string) {
  const trip = storedTrip(db, id);
  if (!trip || trip.organiserUserId !== userId)
    throw new TripFailure("not-found", "Private Trip not found.", 404);
  return trip;
}
function invitationFor(db: Database, trip: Trip) {
  const row = db
    .prepare("SELECT document FROM trip_invitations WHERE trip_id=?")
    .get(trip.id) as { document: string } | undefined;
  const invitation = row
    ? (JSON.parse(row.document) as InvitationRecord)
    : null;
  return invitation?.dataKind === trip.dataKind ? invitation : null;
}
function participantsFor(
  db: Database,
  trip: Trip,
  invitation: InvitationRecord | null,
): GuestParticipant[] {
  const rows = db
    .prepare(
      "SELECT p.document, EXISTS(SELECT 1 FROM guest_sessions s WHERE s.participant_id=p.id AND s.expires_at>?) AS has_session FROM guest_participants p WHERE p.trip_id=? ORDER BY p.rowid",
    )
    .all(new Date().toISOString(), trip.id) as {
    document: string;
    has_session: number;
  }[];
  return rows
    .map((row) => ({
      ...(JSON.parse(row.document) as ParticipantRecord),
      hasSession: !!row.has_session,
    }))
    .filter((participant) => participant.dataKind === trip.dataKind)
    .map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      displayNumber: participant.displayNumber,
      accessActive:
        invitation?.state === "active" &&
        participant.generation === invitation.generation &&
        participant.hasSession,
    }));
}
function management(db: Database, trip: Trip): InvitationManagement {
  const invitation = invitationFor(db, trip);
  return {
    invitation: invitation
      ? {
          generation: invitation.generation,
          token: invitation.token,
          state: invitation.state,
          url: `${getAuthConfiguration().baseURL}/join/${invitation.token}`,
        }
      : null,
    participants: participantsFor(db, trip, invitation),
  };
}
export function readInvitation(userId: string, tripId: string) {
  return transaction((db) => management(db, ownedTrip(db, userId, tripId)));
}
export function changeInvitation(
  userId: string,
  tripId: string,
  action: unknown,
) {
  return transaction((db) => {
    const trip = ownedTrip(db, userId, tripId);
    const current = invitationFor(db, trip);
    if (action === "create" && current) return management(db, trip);
    if (action === "disable") {
      if (!current)
        throw new TripFailure(
          "not-found",
          "No current invitation to disable.",
          404,
        );
      current.state = "disabled";
      db.prepare("UPDATE trip_invitations SET document=? WHERE trip_id=?").run(
        JSON.stringify(current),
        trip.id,
      );
    } else if (action === "create" || action === "replace") {
      const invitation: InvitationRecord = {
        generation: randomUUID(),
        token: randomBytes(32).toString("base64url"),
        state: "active",
        dataKind: trip.dataKind,
      };
      db.prepare(
        "INSERT INTO trip_invitations(trip_id,token_digest,document) VALUES(?,?,?) ON CONFLICT(trip_id) DO UPDATE SET token_digest=excluded.token_digest,document=excluded.document",
      ).run(trip.id, digest(invitation.token), JSON.stringify(invitation));
    } else
      throw new TripFailure(
        "invalid-request",
        "Choose create, disable or replace.",
      );
    return management(db, trip);
  });
}
function linkTrip(db: Database, token: string) {
  if (!guestToken(token)) return unavailable();
  const row = db
    .prepare("SELECT trip_id FROM trip_invitations WHERE token_digest=?")
    .get(digest(token)) as { trip_id: string } | undefined;
  const trip = row ? storedTrip(db, row.trip_id) : null;
  if (!trip) return unavailable();
  const invitation = invitationFor(db, trip);
  if (invitation?.state !== "active") return unavailable();
  return { trip, invitation };
}
function sessionParticipant(
  db: Database,
  trip: Trip,
  invitation: InvitationRecord,
  token: string | null,
) {
  if (!token) return null;
  const rows = db
    .prepare(
      "SELECT p.document FROM guest_sessions s JOIN guest_participants p ON p.id=s.participant_id WHERE s.token_digest=? AND p.trip_id=? AND s.expires_at>? ORDER BY s.rowid DESC",
    )
    .all(digest(token), trip.id, new Date().toISOString()) as {
    document: string;
  }[];
  return (
    rows
      .map((row) => JSON.parse(row.document) as ParticipantRecord)
      .find(
        (participant) =>
          participant.generation === invitation.generation &&
          participant.dataKind === trip.dataKind,
      ) ?? null
  );
}
function shared(
  db: Database,
  trip: Trip,
  invitation: InvitationRecord,
  participant: ParticipantRecord,
): SharedGuestTrip {
  const participants = participantsFor(db, trip, invitation);
  return {
    trip: {
      id: trip.id,
      title: trip.title,
      city: trip.city,
      dataKind: trip.dataKind,
      selectedPlaceIds: trip.selectedPlaceIds,
      dayPlanIds: projectedDayPlanIds(db, trip),
      dayPlan: dayPlanState(db, trip),
      generatedDayPlan: generatedDayPlanState(db, trip),
      savedPlaces: trip.savedPlaces.map((member) => ({
        placeId: member.placeId,
        place: member.place,
        importedEvidence: member.importedEvidence.map((evidence) => ({
          source: evidence.source,
          extraction: evidence.extraction,
          confirmation: evidence.confirmation,
        })),
      })),
    },
    participant: participants.find(
      (item) => item.id === participant.id,
    ) as GuestParticipant,
    participants,
  };
}
export function inspectInvitation(token: string, browserToken: string | null) {
  return transaction((db) => {
    const { trip, invitation } = linkTrip(db, token);
    const participant = sessionParticipant(db, trip, invitation, browserToken);
    return {
      available: true,
      shared: participant ? shared(db, trip, invitation, participant) : null,
    };
  });
}
export function joinInvitation(
  token: string,
  browserToken: string | null,
  displayName: unknown,
) {
  return transaction((db) => {
    const { trip, invitation } = linkTrip(db, token);
    const returning = sessionParticipant(db, trip, invitation, browserToken);
    if (returning)
      return {
        shared: shared(db, trip, invitation, returning),
        token: null,
        expiresAt: null,
        resumed: true,
      };
    if (
      typeof displayName !== "string" ||
      !displayName.trim() ||
      Array.from(displayName.trim()).length > 80 ||
      /[\p{Cc}\p{Cf}]/u.test(displayName)
    )
      throw new TripFailure(
        "invalid-display-name",
        "Use a display name of 1–80 characters without control characters.",
      );
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM guest_participants WHERE trip_id=?",
        )
        .get(trip.id) as { count: number }
    ).count;
    if (count >= 200)
      throw new TripFailure(
        "participant-limit",
        "This Trip has reached its participant limit. Ask the organiser for help.",
        429,
      );
    const participant: ParticipantRecord = {
      id: randomUUID(),
      displayName: displayName.trim(),
      displayNumber: count + 1,
      generation: invitation.generation,
      dataKind: trip.dataKind,
    };
    const knownBrowser =
      browserToken &&
      db
        .prepare(
          "SELECT id FROM guest_sessions WHERE token_digest=? AND expires_at>? LIMIT 1",
        )
        .get(digest(browserToken), new Date().toISOString());
    const sessionToken = knownBrowser
      ? (browserToken as string)
      : randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + GUEST_LIFETIME_MS).toISOString();
    db.prepare(
      "DELETE FROM guest_sessions WHERE expires_at<=? AND participant_id IN (SELECT id FROM guest_participants WHERE json_extract(document, '$.dataKind')=?)",
    ).run(new Date().toISOString(), trip.dataKind);
    db.prepare(
      "INSERT INTO guest_participants(id,trip_id,document) VALUES(?,?,?)",
    ).run(participant.id, trip.id, JSON.stringify(participant));
    db.prepare(
      "INSERT INTO guest_sessions(id,token_digest,participant_id,expires_at) VALUES(?,?,?,?)",
    ).run(randomUUID(), digest(sessionToken), participant.id, expiresAt);
    return {
      shared: shared(db, trip, invitation, participant),
      token: sessionToken,
      expiresAt,
      resumed: false,
    };
  });
}
export function readGuestTrip(tripId: string, browserToken: string | null) {
  return transaction((db) => {
    const trip = storedTrip(db, tripId);
    if (!trip) return unavailable();
    const invitation = invitationFor(db, trip);
    if (invitation?.state !== "active") return unavailable();
    const participant = sessionParticipant(db, trip, invitation, browserToken);
    if (!participant) return unavailable();
    return shared(db, trip, invitation, participant);
  });
}

/** Resolves collaboration authority inside the same transaction as its data. */
export function collaborationAuthority(
  db: Database,
  tripId: string,
  authority: { userId: string } | { browserToken: string | null },
) {
  if ("userId" in authority) {
    const trip = ownedTrip(db, authority.userId, tripId);
    return {
      trip,
      actorId: "organiser",
      participants: participantsFor(db, trip, invitationFor(db, trip)),
    };
  }
  const trip = storedTrip(db, tripId);
  if (!trip) return unavailable();
  const invitation = invitationFor(db, trip);
  if (invitation?.state !== "active") return unavailable();
  const participant = sessionParticipant(
    db,
    trip,
    invitation,
    authority.browserToken,
  );
  if (!participant) return unavailable();
  return {
    trip,
    actorId: participant.id,
    participants: participantsFor(db, trip, invitation),
  };
}
