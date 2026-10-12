import { dayEditingOperation } from "@/server/day-editing";
import { dayGenerationOperation } from "@/server/day-generation";
import { boundedJson, requireSameOrigin } from "@/server/import-http";
import { requireOrganiser, tripError, tripResponse } from "@/server/trip-http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return tripResponse({
      generatedDayPlan: dayGenerationOperation(
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
      generatedDayPlan: dayGenerationOperation(
        user.id,
        (await context.params).id,
        await boundedJson(request),
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const user = await requireOrganiser(request);
    return tripResponse({
      generatedDayPlan: dayEditingOperation(
        user.id,
        (await context.params).id,
        await boundedJson(request, 65536),
      ),
    });
  } catch (error) {
    return tripError(error);
  }
}
