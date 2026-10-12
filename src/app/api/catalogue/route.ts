import { queryCatalogue } from "@/server/catalogue";
export const dynamic = "force-dynamic";
export async function GET() {
  const result = await queryCatalogue({ city: "Shanghai" });
  return Response.json(result, {
    status: result.status === "available" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
