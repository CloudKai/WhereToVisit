import { queryCatalogue } from "@/server/catalogue";
import { parseDiscoveryQuery } from "@/shared/discovery-query";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let query: ReturnType<typeof parseDiscoveryQuery>;
  try {
    query = parseDiscoveryQuery(new URL(request.url).searchParams);
  } catch {
    return Response.json(
      {
        status: "error",
        reason: "invalid-query",
        message:
          "Choose valid discovery filters. Distance needs an explicit origin and radius.",
        retryable: false,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await queryCatalogue(query);
  return Response.json(result, {
    status: result.status === "available" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
