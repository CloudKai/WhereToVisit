import {
  boundedJson,
  importError,
  importResponse,
  requestSession,
  requireSameOrigin,
} from "@/server/import-http";
import { resolveImport } from "@/server/import-jobs";
import { ImportFailure } from "@/server/import-policy";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const input = await boundedJson(request);
    if (
      !(input.action === "resolve" && Object.keys(input).length === 1) &&
      !(
        input.action === "confirm" &&
        typeof input.mentionId === "string" &&
        typeof input.candidateId === "string" &&
        (input.acknowledgeOutsideCity === undefined ||
          typeof input.acknowledgeOutsideCity === "boolean") &&
        Object.keys(input).every((key) =>
          [
            "action",
            "mentionId",
            "candidateId",
            "acknowledgeOutsideCity",
          ].includes(key),
        )
      )
    )
      throw new ImportFailure(
        "invalid-request",
        "Resolve a draft or confirm a specific returned candidate.",
      );
    const job = await resolveImport(
      await requestSession(),
      (await context.params).id,
      input as Parameters<typeof resolveImport>[2],
    );
    return job
      ? importResponse({ job })
      : importResponse(
          {
            error: {
              code: "not-found",
              message: "Import not found in this session.",
            },
          },
          404,
        );
  } catch (error) {
    return importError(error);
  }
}
