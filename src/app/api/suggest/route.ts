import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { suggestDestinations } from "@/lib/geoapify";
import { failureReason, WindowCounter } from "@/lib/http";
import { searchNominatim } from "@/lib/nominatim";
import type { Suggestion } from "@/lib/types";

// Soft per-visitor limit so a runaway client cannot burn the free API quota.
const limiter = new WindowCounter(60_000);
const LIMIT_PER_MINUTE = 40;
// OpenStreetMap's geocoder allows at most one request per second in total.
const backupLimiter = new WindowCounter(1_100);

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const text = params.get("q")?.trim() ?? "";
  // Only a person pressing Enter may use the backup lookup, never typing.
  const submitted = params.get("submit") === "1";
  if (text.length < 2 || text.length > 80) {
    return NextResponse.json({ suggestions: [] });
  }
  if (!limiter.take(clientKey(request), LIMIT_PER_MINUTE)) {
    return NextResponse.json(
      { suggestions: [], error: "rate-limited" },
      { status: 429, headers: { "retry-after": "30" } },
    );
  }

  const { geoapifyKey, wikimediaContact } = getConfig();
  let failure: "not-configured" | "key-rejected" | "quota" | "unavailable" =
    "not-configured";

  if (geoapifyKey) {
    try {
      const suggestions = await suggestDestinations(text, geoapifyKey);
      return NextResponse.json(
        { suggestions },
        { headers: { "cache-control": "private, max-age=300" } },
      );
    } catch (error) {
      console.warn(`[suggest] Geoapify lookup failed: ${describe(error)}`);
      failure = failureReason(error);
    }
  }

  if (submitted) {
    if (!backupLimiter.take("nominatim", 1)) {
      return NextResponse.json(
        { suggestions: [], error: "rate-limited" },
        { status: 429, headers: { "retry-after": "2" } },
      );
    }
    try {
      const suggestions: Suggestion[] = await searchNominatim(
        text,
        wikimediaContact,
      );
      return NextResponse.json({ suggestions, source: "backup" });
    } catch (error) {
      console.warn(`[suggest] backup lookup failed: ${describe(error)}`);
    }
  }

  return NextResponse.json(
    { suggestions: [], error: failure },
    { status: failure === "not-configured" ? 503 : 502 },
  );
}
