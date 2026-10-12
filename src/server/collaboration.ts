import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Collaboration, Place } from "@/shared/contracts";
import { queryCatalogue } from "./catalogue";
import { openDatabase } from "./db/connection";
import { collaborationAuthority } from "./invitations";
import { TripFailure } from "./trips";

type Authority = Parameters<typeof collaborationAuthority>[2];
type Stored = Pick<Collaboration, "votes" | "comments" | "suggestions"> & {
  receipts: { actorId: string; id: string; hash: string }[];
};
function invalid(message = "Supply a valid collaboration operation."): never {
  throw new TripFailure("invalid-request", message);
}
function boundedText(value: unknown, limit: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value.trim()).length > limit ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  )
    invalid(`Use 1–${limit} characters without control characters.`);
  return value.trim();
}
type Candidate = { place: Place; kind: "real" | "fixture" };
function operation(
  tripId: string,
  authority: Authority,
  input: Record<string, unknown>,
  candidate: undefined,
  receiptOnly: true,
): Collaboration | null;
function operation(
  tripId: string,
  authority: Authority,
  input?: Record<string, unknown>,
  candidate?: Candidate,
): Collaboration;
function operation(
  tripId: string,
  authority: Authority,
  input?: Record<string, unknown>,
  candidate?: Candidate,
  receiptOnly = false,
) {
  const { sqlite: db } = openDatabase();
  try {
    return db.transaction(() => {
      // Authorization always precedes receipt lookup, including retries after revocation.
      const { trip, actorId, participants } = collaborationAuthority(
        db,
        tripId,
        authority,
      );
      const id = `${trip.id}:${trip.dataKind}`;
      const row = db
        .prepare("SELECT document FROM trip_collaboration WHERE id=?")
        .get(id) as { document: string } | undefined;
      const state: Stored = row
        ? JSON.parse(row.document)
        : { votes: [], comments: [], suggestions: [], receipts: [] };
      if (input) {
        if (
          typeof input.operationId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(input.operationId)
        )
          invalid("A fresh operation identity is required for safe retry.");
        const hash = createHash("sha256")
          .update(
            JSON.stringify(
              Object.fromEntries(
                Object.entries(input)
                  .filter(([key]) => key !== "operationId")
                  .sort(([a], [b]) => a.localeCompare(b)),
              ),
            ),
          )
          .digest("hex");
        const receipt = state.receipts.find(
          (item) => item.actorId === actorId && item.id === input.operationId,
        );
        if (receipt && receipt.hash !== hash)
          throw new TripFailure(
            "operation-conflict",
            "This operation identity was used for a different change. Refresh and try a new change.",
            409,
          );
        if (!receipt) {
          if (receiptOnly) return null;
          if (state.receipts.length >= 10000)
            throw new TripFailure(
              "collaboration-limit",
              "This Trip has reached its collaboration operation limit.",
              429,
            );
          const allowed: Record<string, string[]> = {
            vote: ["placeId", "choice"],
            comment: ["placeId", "text", "commentId"],
            suggest: ["placeId", "name"],
            amend: ["suggestionId", "placeId", "name"],
            accept: ["suggestionId"],
            reject: ["suggestionId"],
            confirm: ["suggestionId", "placeId"],
          };
          if (
            typeof input.action !== "string" ||
            !Object.hasOwn(allowed, input.action)
          )
            invalid();
          const fields = allowed[input.action];
          if (
            !fields ||
            !Object.keys(input).every((key) =>
              ["action", "operationId", ...fields].includes(key),
            )
          )
            invalid();
          if (["vote", "comment"].includes(String(input.action))) {
            if (
              !trip.savedPlaces.some(
                (member) => member.placeId === input.placeId,
              )
            )
              invalid("Choose a saved Place in this Trip.");
            if (input.action === "vote") {
              if (
                !["must-go", "interested", "skip", null].includes(
                  input.choice as string | null,
                )
              )
                invalid("Choose Must go, Interested, Skip or no vote.");
              state.votes = state.votes.filter(
                (vote) =>
                  vote.actorId !== actorId || vote.placeId !== input.placeId,
              );
              if (input.choice !== null)
                state.votes.push({
                  actorId,
                  placeId: input.placeId as string,
                  choice:
                    input.choice as Collaboration["votes"][number]["choice"],
                });
            } else {
              const own = state.comments.find(
                (comment) =>
                  comment.actorId === actorId &&
                  comment.placeId === input.placeId,
              );
              if (input.commentId !== undefined && input.commentId !== own?.id)
                throw new TripFailure(
                  "permission-denied",
                  "You may amend only your own Place comment.",
                  403,
                );
              const text = boundedText(input.text, 1000);
              if (own) own.text = text;
              else {
                if (state.comments.length >= 2000)
                  throw new TripFailure(
                    "collaboration-limit",
                    "This Trip has reached its comment limit.",
                    429,
                  );
                state.comments.push({
                  id: randomUUID(),
                  actorId,
                  placeId: input.placeId as string,
                  text,
                });
              }
            }
          } else if (["suggest", "amend"].includes(String(input.action))) {
            if ((input.placeId !== undefined) === (input.name !== undefined))
              invalid("Choose one canonical branch or one unresolved name.");
            if (
              candidate &&
              (candidate.kind !== trip.dataKind ||
                candidate.place.city !== trip.city)
            )
              invalid(
                "Real and fictional suggestions must remain in separate Shanghai Trips.",
              );
            const name = candidate
              ? candidate.place.displayName
              : boundedText(input.name, 120);
            const values = { name, place: candidate?.place ?? null };
            if (input.action === "amend") {
              const suggestion = state.suggestions.find(
                (item) => item.id === input.suggestionId,
              );
              if (!suggestion || suggestion.actorId !== actorId)
                throw new TripFailure(
                  "permission-denied",
                  "You may amend only your own pending suggestion.",
                  403,
                );
              if (suggestion.state !== "pending")
                throw new TripFailure(
                  "suggestion-conflict",
                  "Only pending suggestions can be amended.",
                  409,
                );
              Object.assign(suggestion, values);
            } else {
              if (
                state.suggestions.length >= 200 ||
                state.suggestions.filter((item) => item.actorId === actorId)
                  .length >= 50
              )
                throw new TripFailure(
                  "collaboration-limit",
                  "This Trip or participant has reached its suggestion limit.",
                  429,
                );
              state.suggestions.push({
                id: randomUUID(),
                actorId,
                ...values,
                state: "pending",
              });
            }
          } else {
            if (actorId !== "organiser")
              throw new TripFailure(
                "permission-denied",
                "Only the organiser can review suggestions.",
                403,
              );
            const suggestion = state.suggestions.find(
              (item) => item.id === input.suggestionId,
            );
            if (!suggestion)
              throw new TripFailure(
                "not-found",
                "Suggestion unavailable.",
                404,
              );
            if (input.action === "confirm") {
              if (suggestion.state !== "accepted" || !candidate)
                invalid(
                  "Accept the unresolved request, then explicitly confirm a canonical branch.",
                );
              if (
                candidate.kind !== trip.dataKind ||
                candidate.place.city !== trip.city
              )
                invalid(
                  "Choose a canonical Shanghai branch of this Trip's data kind.",
                );
              if (
                suggestion.place &&
                suggestion.place.id !== candidate.place.id
              )
                throw new TripFailure(
                  "suggestion-conflict",
                  "This suggestion already has a confirmed branch.",
                  409,
                );
              suggestion.place ??= candidate.place;
            } else {
              const next = input.action === "accept" ? "accepted" : "rejected";
              if (suggestion.state !== "pending" && suggestion.state !== next)
                throw new TripFailure(
                  "suggestion-conflict",
                  "This suggestion has already been reviewed. Refresh to see its state.",
                  409,
                );
              suggestion.state = next;
            }
            if (
              suggestion.state === "accepted" &&
              suggestion.place &&
              !trip.savedPlaces.some(
                (member) => member.placeId === suggestion.place?.id,
              )
            ) {
              if (trip.savedPlaces.length >= 100)
                throw new TripFailure(
                  "too-many-places",
                  "A Trip can retain up to 100 Places.",
                  429,
                );
              trip.savedPlaces.push({
                placeId: suggestion.place.id,
                place: suggestion.place,
                evidenceIds: suggestion.place.evidence.map((item) => item.id),
                importedEvidence: [],
              });
              trip.updatedAt = new Date().toISOString();
              db.prepare(
                "UPDATE trips SET document=? WHERE id=? AND organiser_user_id=?",
              ).run(JSON.stringify(trip), trip.id, trip.organiserUserId);
            }
          }
          state.receipts.push({ actorId, id: input.operationId, hash });
          db.prepare(
            "INSERT INTO trip_collaboration(id,trip_id,document) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
          ).run(id, tripId, JSON.stringify(state));
        }
      }
      return {
        actorId,
        participants,
        votes: state.votes.filter((vote) =>
          trip.savedPlaces.some((member) => member.placeId === vote.placeId),
        ),
        comments: state.comments.filter((comment) =>
          trip.savedPlaces.some((member) => member.placeId === comment.placeId),
        ),
        suggestions: state.suggestions,
      };
    })();
  } finally {
    db.close();
  }
}
export function readCollaboration(tripId: string, authority: Authority) {
  return operation(tripId, authority);
}
export async function changeCollaboration(
  tripId: string,
  authority: Authority,
  input: Record<string, unknown>,
) {
  // Resolve known receipts before catalogue work, checking current authority first.
  // A fresh mutation checks both authority and receipt again after asynchronous lookup.
  const replay = operation(tripId, authority, input, undefined, true);
  if (replay) return replay;
  let candidate: { place: Place; kind: "real" | "fixture" } | undefined;
  if (
    ["suggest", "amend", "confirm"].includes(String(input.action)) &&
    input.placeId !== undefined
  ) {
    if (typeof input.placeId !== "string") invalid();
    const result = await queryCatalogue({ city: "Shanghai" });
    if (result.status !== "available")
      throw new TripFailure(
        "catalogue-unavailable",
        "Canonical branches are unavailable. Retry explicitly.",
        503,
      );
    const place = result.data.places.find((item) => item.id === input.placeId);
    if (!place) invalid("Choose an available canonical Shanghai branch.");
    candidate = { place, kind: result.data.dataKind };
  }
  return operation(tripId, authority, input, candidate);
}
