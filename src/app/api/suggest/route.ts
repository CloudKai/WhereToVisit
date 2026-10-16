import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { suggestDestinations } from "@/lib/geoapify";
import { WindowCounter } from "@/lib/http";

// Soft per-visitor limit so a runaway client cannot burn the free API quota.
const limiter = new WindowCounter(60_000);
const LIMIT_PER_MINUTE = 40;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

export async function GET(request: Request) {
  const text = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (text.length < 2 || text.length > 80) {
    return NextResponse.json({ suggestions: [] });
  }
  if (!limiter.take(clientKey(request), LIMIT_PER_MINUTE)) {
    return NextResponse.json(
      { suggestions: [], error: "rate-limited" },
      { status: 429, headers: { "retry-after": "30" } },
    );
  }
  const { geoapifyKey } = getConfig();
  if (!geoapifyKey) {
    return NextResponse.json(
      { suggestions: [], error: "not-configured" },
      { status: 503 },
    );
  }
  try {
    const suggestions = await suggestDestinations(text, geoapifyKey);
    return NextResponse.json(
      { suggestions },
      { headers: { "cache-control": "private, max-age=300" } },
    );
  } catch (error) {
    console.warn(
      `[suggest] lookup failed: ${error instanceof Error ? error.message : "error"}`,
    );
    return NextResponse.json(
      { suggestions: [], error: "unavailable" },
      { status: 502 },
    );
  }
}
