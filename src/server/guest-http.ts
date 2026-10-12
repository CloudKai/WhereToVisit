import "server-only";
import { cookies } from "next/headers";
import { getAuthConfiguration } from "./config";
import { GUEST_COOKIE, guestToken } from "./invitations";
export async function guestBrowserToken() {
  return guestToken((await cookies()).get(GUEST_COOKIE)?.value);
}
export async function persistGuestCookie(token: string, expiresAt: string) {
  (await cookies()).set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
    secure:
      process.env.NODE_ENV === "production" &&
      getAuthConfiguration().baseURL.startsWith("https:"),
  });
}
