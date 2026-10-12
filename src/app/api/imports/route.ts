import { after } from "next/server";
import {
  boundedJson,
  importError,
  importResponse,
  requestIp,
  requestSession,
  requireSameOrigin,
} from "@/server/import-http";
import {
  createImport,
  listImports,
  runImportQueue,
} from "@/server/import-jobs";
import { ImportFailure } from "@/server/import-policy";
export const runtime = "nodejs";
export async function GET() {
  try {
    const jobs = listImports(await requestSession());
    after(runImportQueue);
    return importResponse({ jobs });
  } catch (error) {
    return importError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await boundedJson(request);
    if (Object.keys(input).length !== 1 || typeof input.sourceUrl !== "string")
      throw new ImportFailure(
        "invalid-request",
        "Supply only one sourceUrl string.",
      );
    const job = createImport(
      await requestSession(),
      requestIp(request),
      input.sourceUrl,
    );
    after(runImportQueue);
    return importResponse({ job }, 202);
  } catch (error) {
    return importError(error);
  }
}
