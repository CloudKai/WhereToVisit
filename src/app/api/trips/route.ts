import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
import { createTrip, listTrips, TripFailure } from "@/server/trips";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireOrganiser(request);
    return tripResponse({
      user: { id: user.id, email: user.email },
      trips: listTrips(user.id),
    });
  } catch (error) {
    return tripError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireOrganiser(request);
    const input = await boundedJson(request);
    if (Object.keys(input).some((key) => !["title", "city"].includes(key)))
      throw new TripFailure(
        "invalid-request",
        "Supply only a Trip title and city.",
      );
    return tripResponse(
      { trip: createTrip(user.id, input.title, input.city) },
      201,
    );
  } catch (error) {
    return tripError(error);
  }
}
