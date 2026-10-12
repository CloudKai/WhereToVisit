import { NextResponse } from "next/server";
import { organiser } from "./auth";
import { ImportFailure } from "./import-policy";
import { TripFailure } from "./trips";
export async function requireOrganiser(request: Request) {
  const user = await organiser(request);
  if (!user)
    throw new TripFailure(
      "sign-in-required",
      "Sign in to manage your private Trips.",
      401,
    );
  return user;
}
export function tripResponse(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function tripError(error: unknown) {
  const failure =
    error instanceof TripFailure
      ? error
      : error instanceof ImportFailure
        ? new TripFailure(
            error.code,
            error.message,
            error.code === "invalid-origin" ? 403 : 400,
          )
        : new TripFailure(
            "storage-unavailable",
            "Your Trip could not be saved or loaded. Retry explicitly.",
            503,
          );
  return tripResponse(
    {
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.status === 503,
      },
    },
    failure.status,
  );
}
