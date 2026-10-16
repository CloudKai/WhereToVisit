import { readReviewedPhoto } from "@/server/branch-photo";
import { queryCatalogue } from "@/server/catalogue";
import { eligibleBranchPhoto } from "@/shared/branch-photo";

export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: RouteContext<"/api/catalogue/photos/[id]">,
) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    const { id } = await context.params;
    if (new URL(request.url).search) throw new Error("Unexpected photo query.");
    const result = await queryCatalogue({ city: "Shanghai" });
    const photo =
      result.status === "available"
        ? result.data.places
            .map((place) => eligibleBranchPhoto(place.photo, place.id))
            .find((item) => item?.assetId === id)
        : null;
    if (!photo) throw new Error("Photo is unavailable.");
    const bytes = readReviewedPhoto(photo.assetId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        Link: `<${photo.sourceUrl}>; rel="describedby", <${photo.licenseUrl}>; rel="license"`,
      },
    });
  } catch {
    return new Response("Branch photo unavailable.", { status: 404, headers });
  }
}
