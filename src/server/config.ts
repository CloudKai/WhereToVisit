import "server-only";
export function getAuthConfiguration() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || secret.includes("REPLACE_WITH"))
    throw new Error(
      "Set a generated BETTER_AUTH_SECRET of at least 32 characters.",
    );
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new Error("Set BETTER_AUTH_URL to the browser origin.");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("BETTER_AUTH_URL must be an HTTP(S) origin.");
  return { secret, baseURL: url.origin };
}
