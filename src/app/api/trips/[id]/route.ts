import {
  boundedJson,
  requestSession,
  requireSameOrigin,
} from "@/server/import-http";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
import { readSaveIntent } from "@/server/trip-save-intents";
import { changeTrip, getTrip, TripFailure, tripInput } from "@/server/trips";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireOrganiser(request);
    const trip = getTrip(user.id, (await context.params).id);
    if (!trip)
      throw new TripFailure("not-found", "Private Trip not found.", 404);
    return tripResponse({ trip });
  } catch (error) {
    return tripError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const user = await requireOrganiser(request);
    const input = await boundedJson(request);
    const id = (await context.params).id;
    if (!getTrip(user.id, id))
      throw new TripFailure("not-found", "Private Trip not found.", 404);
    const intent =
      input.action === "save" && typeof input.intentId === "string"
        ? readSaveIntent(await requestSession(), user.id, input.intentId)
        : null;
    const trip = changeTrip(user.id, id, (trip) => {
      if (
        input.action === "update" &&
        Object.keys(input).every((key) =>
          ["action", "title", "city"].includes(key),
        )
      )
        Object.assign(trip, tripInput(input.title, input.city));
      else if (
        input.action === "save" &&
        intent &&
        Object.keys(input).every((key) => ["action", "intentId"].includes(key))
      ) {
        if (trip.savedPlaces.length && trip.dataKind !== intent.dataKind)
          throw new TripFailure(
            "mixed-data",
            "Real and fictional collections must stay in separate Trips.",
          );
        trip.dataKind = intent.dataKind;
        let member = trip.savedPlaces.find(
          (item) => item.placeId === intent.place.id,
        );
        if (!member) {
          if (trip.savedPlaces.length >= 100)
            throw new TripFailure(
              "too-many-places",
              "A Trip can retain up to 100 Places.",
              429,
            );
          member = {
            placeId: intent.place.id,
            place: intent.place,
            evidenceIds: intent.place.evidence.map((item) => item.id),
            importedEvidence: [],
          };
          trip.savedPlaces.push(member);
        }
        for (const evidence of intent.importedEvidence) {
          if (
            !member.importedEvidence.some(
              (item) =>
                item.importId === evidence.importId &&
                item.mentionId === evidence.mentionId,
            )
          )
            member.importedEvidence.push(evidence);
          if (!member.evidenceIds.includes(evidence.source.id))
            member.evidenceIds.push(evidence.source.id);
        }
      } else if (
        ["remove", "select"].includes(String(input.action)) &&
        typeof input.placeId === "string" &&
        Object.keys(input).every((key) =>
          ["action", "placeId", "selected"].includes(key),
        )
      ) {
        if (input.action === "remove") {
          trip.savedPlaces = trip.savedPlaces.filter(
            (item) => item.placeId !== input.placeId,
          );
          trip.selectedPlaceIds = trip.selectedPlaceIds.filter(
            (item) => item !== input.placeId,
          );
        } else {
          if (
            typeof input.selected !== "boolean" ||
            !trip.savedPlaces.some((item) => item.placeId === input.placeId)
          )
            throw new TripFailure(
              "invalid-selection",
              "Choose a saved Place and a selection state.",
            );
          trip.selectedPlaceIds = trip.selectedPlaceIds.filter(
            (item) => item !== input.placeId,
          );
          if (input.selected) trip.selectedPlaceIds.push(input.placeId);
        }
      } else
        throw new TripFailure(
          "invalid-request",
          "Supply a title update, explicit save, removal or selection.",
        );
    });
    return tripResponse({ trip });
  } catch (error) {
    return tripError(error);
  }
}
