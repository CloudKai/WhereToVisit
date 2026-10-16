import { dayPlanOperation } from "@/server/day-plans";
import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return tripResponse({
      dayPlan: dayPlanOperation(
        (await requireOrganiser(request)).id,
        (await context.params).id,
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const user = await requireOrganiser(request);
    return tripResponse({
      dayPlan: dayPlanOperation(
        user.id,
        (await context.params).id,
        await boundedJson(request, 16384),
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}
