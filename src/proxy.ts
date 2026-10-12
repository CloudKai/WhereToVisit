import { NextResponse } from "next/server";
// Reject before streaming: a hidden fixture page must have a real 404 response.
export function proxy() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ENABLE_DEVELOPMENT_FIXTURES !== "1"
  ) {
    return new NextResponse("Development examples are unavailable.", {
      status: 404,
    });
  }
  return NextResponse.next();
}
export const config = { matcher: "/development" };
