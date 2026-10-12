import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth/minimal";
import { authOptions } from "./auth-options";
// Schema generation has no account, database connection or reusable secret.
export const auth = betterAuth({
  ...authOptions,
  secret: randomBytes(32).toString("base64url"),
  baseURL: "http://127.0.0.1:8080",
});
