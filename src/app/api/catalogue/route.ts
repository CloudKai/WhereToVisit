import { queryCatalogue } from "@/server/catalogue";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  if (
    [...parameters.keys()].some((key) => key !== "city") ||
    parameters.getAll("city").length > 1
  ) {
    return Response.json(
      {
        status: "error",
        reason: "query-not-supported",
        message:
          "This catalogue operation accepts a single city. Filters are not available yet.",
        retryable: false,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const city = parameters.get("city") ?? "Shanghai";
  const result = await queryCatalogue({ city });
  return Response.json(result, {
    status: result.status === "available" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
