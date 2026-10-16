import { NextResponse } from "next/server";
import { getConfig } from "./config.ts";
import { allow, RoomError } from "./rooms.ts";
import { getStore, StorageError, type Store } from "./store.ts";

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "cache-control": "no-store" } as const;

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...headers },
  });
}

export function fail(
  status: number,
  message: string,
  headers: Record<string, string> = {},
) {
  return json({ error: message }, status, headers);
}

export function clientId(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  );
}

/** The shared store, or a ready-made 503 response when sharing is unavailable. */
export function requireStore():
  | { store: Store; response?: undefined }
  | { store?: undefined; response: NextResponse } {
  const store = getStore(getConfig());
  if (store) return { store };
  return {
    response: fail(
      503,
      "Sharing for voting isn’t set up on this server yet. The site owner needs to connect storage.",
    ),
  };
}

/** Reads a small JSON object body; throws RoomError for anything else. */
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  // Requiring JSON means other websites cannot post here with a plain form.
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    throw new RoomError(415, "Expected JSON");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    throw new RoomError(413, "Request too large");
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new RoomError(400, "Invalid JSON");
}

export async function limit(
  store: Store,
  request: Request,
  bucket: string,
  max: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  if (await allow(store, bucket, clientId(request), max, windowSeconds))
    return null;
  return fail(429, "Too many requests. Please wait a moment.", {
    "retry-after": "30",
  });
}

/** Maps expected failures to friendly responses; hides unexpected details. */
export function handleError(error: unknown): NextResponse {
  if (error instanceof RoomError) return fail(error.status, error.message);
  if (error instanceof StorageError) {
    console.warn(`[rooms] storage problem: ${error.message}`);
    return fail(
      503,
      "Voting is temporarily unavailable. Please try again shortly.",
    );
  }
  console.error(
    "[rooms] unexpected error",
    error instanceof Error ? error.name : "unknown",
  );
  return fail(500, "Something went wrong.");
}
