import { requestSession } from "@/server/import-http";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
import { readSaveIntent } from "@/server/trip-save-intents";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireOrganiser(request);
    return tripResponse({
      intent: readSaveIntent(
        await requestSession(),
        user.id,
        (await context.params).id,
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}
