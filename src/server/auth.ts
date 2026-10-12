import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { authOptions } from "./auth-options";
import { getAuthConfiguration } from "./config";
import { getDatabase } from "./db";

function createAuth() {
  return betterAuth({
    ...authOptions,
    ...getAuthConfiguration(),
    database: drizzleAdapter(getDatabase(), { provider: "sqlite" }),
    session: { cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-up/email": { window: 60, max: 10 },
        "/sign-in/email": { window: 60, max: 10 },
      },
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  auth ??= createAuth();
  return auth;
}
export async function organiser(request: Request) {
  return (
    (
      await getAuth().api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true },
      })
    )?.user ?? null
  );
}
