import { guestBrowserToken } from "@/server/guest-http";
import { readGuestTrip } from "@/server/invitations";
import { tripError, tripResponse } from "@/server/trip-http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return tripResponse({
      shared: readGuestTrip(
        (await context.params).id,
        await guestBrowserToken(),
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}
