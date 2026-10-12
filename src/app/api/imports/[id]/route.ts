import { after } from "next/server";
import {
  boundedJson,
  importError,
  importResponse,
  requestIp,
  requestSession,
  requireSameOrigin,
} from "@/server/import-http";
import { getImport, mutateImport, runImportQueue } from "@/server/import-jobs";
import { ImportFailure } from "@/server/import-policy";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const job = getImport(await requestSession(), (await context.params).id);
    after(runImportQueue);
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
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const input = await boundedJson(request);
    if (
      Object.keys(input).length !== 1 ||
      !["retry", "cancel", "delete"].includes(String(input.action))
    )
      throw new ImportFailure(
        "invalid-request",
        "Choose retry, cancel or delete.",
      );
    const job = mutateImport(
      await requestSession(),
      requestIp(request),
      (await context.params).id,
      input.action as "retry" | "cancel" | "delete",
    );
    after(runImportQueue);
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
