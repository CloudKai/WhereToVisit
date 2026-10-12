import { changeCollaboration, readCollaboration } from "@/server/collaboration";
import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return tripResponse({
      collaboration: readCollaboration((await context.params).id, {
        userId: (await requireOrganiser(request)).id,
      }),
    });
  } catch (error) {
    return tripError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const authority = { userId: (await requireOrganiser(request)).id };
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
