import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { isLat, isLon } from "@/lib/geo";
import { WindowCounter } from "@/lib/http";
import { planRoute } from "@/lib/ors";
import { MODES, type LatLon, type Mode } from "@/lib/routing";
import { MAX_STOPS_PER_DAY } from "@/lib/plan";

const limiter = new WindowCounter(60_000);
const LIMIT_PER_MINUTE = 20;
const MAX_BODY_BYTES = 4096;

function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!limiter.take(clientKey(request), LIMIT_PER_MINUTE)) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "retry-after": "30" } },
    );
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return bad("Request too large", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return bad("Invalid JSON");
  }
  if (typeof body !== "object" || body === null) return bad("Invalid request");
  const { stops, mode, optimise } = body as {
    stops?: unknown;
    mode?: unknown;
    optimise?: unknown;
  };

  if (
    !Array.isArray(stops) ||
    stops.length < 2 ||
    stops.length > MAX_STOPS_PER_DAY
  ) {
    return bad(`Provide between 2 and ${MAX_STOPS_PER_DAY} stops`);
  }
  const points: LatLon[] = [];
  for (const stop of stops) {
    const { lat, lon } = (stop ?? {}) as { lat?: unknown; lon?: unknown };
    if (typeof lat !== "number" || typeof lon !== "number")
      return bad("Invalid stop");
    if (!isLat(lat) || !isLon(lon)) return bad("Invalid coordinates");
    points.push({ lat, lon });
  }
  if (!MODES.includes(mode as Mode)) return bad("Invalid travel mode");

  const result = await planRoute(
    points,
    mode as Mode,
    optimise === true,
    getConfig(),
  );
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
