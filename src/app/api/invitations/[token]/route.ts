import { guestBrowserToken, persistGuestCookie } from "@/server/guest-http";
import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { inspectInvitation, joinInvitation } from "@/server/invitations";
import { tripError, tripResponse } from "@/server/trip-http";
import { TripFailure } from "@/server/trips";
export const runtime = "nodejs";
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    return tripResponse(
      inspectInvitation(
        (await context.params).token,
        await guestBrowserToken(),
      ),
    );
  } catch (error) {
    return tripError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const input = await boundedJson(request);
    if (Object.keys(input).some((key) => key !== "displayName"))
      throw new TripFailure(
        "invalid-request",
        "Supply only your display name.",
      );
    const result = joinInvitation(
      (await context.params).token,
      await guestBrowserToken(),
      input.displayName,
    );
    if (result.token && result.expiresAt)
      await persistGuestCookie(result.token, result.expiresAt);
    return tripResponse({ shared: result.shared }, result.resumed ? 200 : 201);
  } catch (error) {
    return tripError(error);
  }
}
