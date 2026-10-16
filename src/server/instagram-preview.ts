import "server-only";

// This qualifies only the local loopback pair exercised by extension03.
// Public deployments need their own origin, cookie and CSP qualification.
export function localInstagramPreviewOrigin(requestHost: string | null) {
  if (process.env.INSTAGRAM_PREVIEW_LOCAL_ENABLED !== "1") return null;
  const app = process.env.BETTER_AUTH_URL ?? "";
  const wrapper = process.env.INSTAGRAM_PREVIEW_WRAPPER_ORIGIN ?? "";
  if (!/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(app)) return null;
  if (!/^http:\/\/localhost:[0-9]{4,5}$/.test(wrapper)) return null;
  try {
    const appUrl = new URL(app);
    const wrapperUrl = new URL(wrapper);
    if (
      appUrl.origin !== app ||
      wrapperUrl.origin !== wrapper ||
      requestHost !== appUrl.host ||
      Number(appUrl.port) < 1024 ||
      Number(wrapperUrl.port) < 1024
    )
      return null;
    return wrapper;
  } catch {
    return null;
  }
}
