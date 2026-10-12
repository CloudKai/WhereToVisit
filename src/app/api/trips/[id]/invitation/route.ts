import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { changeInvitation, readInvitation } from "@/server/invitations";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
import { TripFailure } from "@/server/trips";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireOrganiser(request);
    return tripResponse(readInvitation(user.id, (await context.params).id));
  } catch (error) {
    return tripError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const user = await requireOrganiser(request);
    const input = await boundedJson(request);
    if (Object.keys(input).some((key) => key !== "action"))
      throw new TripFailure(
        "invalid-request",
        "Supply only an invitation action.",
      );
    return tripResponse(
      changeInvitation(user.id, (await context.params).id, input.action),
      input.action === "create" ? 201 : 200,
    );
  } catch (error) {
    return tripError(error);
  }
}
