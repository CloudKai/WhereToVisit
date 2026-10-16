import { importResponse } from "@/server/import-http";
import { referenceError } from "@/server/social-reference-http";
import { referenceBranches } from "@/server/social-references";
export const runtime = "nodejs";
export async function GET() {
  try {
    return importResponse({ branches: referenceBranches() });
  } catch (error) {
    return referenceError(error);
  }
}
