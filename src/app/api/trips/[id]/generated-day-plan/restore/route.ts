import { dayRestorationOperation } from "@/server/day-restoration";
import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const user = await requireOrganiser(request);
    return tripResponse({
      generatedDayPlan: dayRestorationOperation(
        user.id,
        (await context.params).id,
        await boundedJson(request),
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}
