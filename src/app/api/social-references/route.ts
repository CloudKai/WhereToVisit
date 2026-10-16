import {
  boundedJson,
  importResponse,
  requestIp,
  requestSession,
  requireSameOrigin,
} from "@/server/import-http";
import { referenceError } from "@/server/social-reference-http";
import { createReference, listReferences } from "@/server/social-references";
export const runtime = "nodejs";
export async function GET() {
  try {
    return importResponse({
      references: listReferences(await requestSession()),
    });
  } catch (error) {
    return referenceError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await boundedJson(request, 8192);
    return importResponse(
      createReference(await requestSession(), requestIp(request), input),
      201,
    );
  } catch (error) {
    return referenceError(error);
  }
}
