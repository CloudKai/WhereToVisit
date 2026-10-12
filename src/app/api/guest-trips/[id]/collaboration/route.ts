import { changeCollaboration, readCollaboration } from "@/server/collaboration";
import { guestBrowserToken } from "@/server/guest-http";
import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { tripError, tripResponse } from "@/server/trip-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    return tripResponse({
      collaboration: readCollaboration((await context.params).id, {
        browserToken: await guestBrowserToken(),
      }),
    });
  } catch (error) {
    return tripError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const authority = { browserToken: await guestBrowserToken() };
    const input = await boundedJson(request);
    return tripResponse({
      collaboration: await changeCollaboration(
        (await context.params).id,
        authority,
        input,
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}
