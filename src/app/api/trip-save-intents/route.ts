import { organiser } from "@/server/auth";
import {
  boundedJson,
  requestSession,
  requireSameOrigin,
} from "@/server/import-http";
import { tripError, tripResponse } from "@/server/trip-http";
import { prepareSave } from "@/server/trip-save-intents";
import { TripFailure } from "@/server/trips";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await boundedJson(request);
    if (
      Object.keys(input).some((key) => !["placeId", "importId"].includes(key))
    )
      throw new TripFailure(
        "invalid-request",
        "Choose a canonical branch and optional source draft.",
      );
    const user = await organiser(request);
    return tripResponse(
      {
        intent: await prepareSave(
          await requestSession(),
          user?.id ?? null,
          input.placeId,
          input.importId,
        ),
      },
      201,
    );
  } catch (error) {
    return tripError(error);
  }
}
