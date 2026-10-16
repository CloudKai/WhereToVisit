import {
  boundedJson,
  importResponse,
  requestIp,
  requestSession,
  requireSameOrigin,
} from "@/server/import-http";
import {
  missingReference,
  referenceError,
} from "@/server/social-reference-http";
import {
  chooseReferenceBranch,
  readReference,
} from "@/server/social-references";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const reference = readReference(
      await requestSession(),
      (await context.params).id,
    );
    return reference ? importResponse({ reference }) : missingReference();
  } catch (error) {
    return referenceError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const reference = readReference(
      await requestSession(),
      (await context.params).id,
      true,
    );
    return reference ? importResponse({ deleted: true }) : missingReference();
  } catch (error) {
    return referenceError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const input = await boundedJson(request, 1024);
    const reference = chooseReferenceBranch(
      await requestSession(),
      requestIp(request),
      (await context.params).id,
      input,
    );
    return reference ? importResponse({ reference }) : missingReference();
  } catch (error) {
    return referenceError(error);
  }
}
