import http from "node:http";

const appOrigin = process.env.BETTER_AUTH_URL ?? "";
const wrapperOrigin = process.env.INSTAGRAM_PREVIEW_WRAPPER_ORIGIN ?? "";
if (
  process.env.INSTAGRAM_PREVIEW_LOCAL_ENABLED !== "1" ||
  !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(appOrigin) ||
  !/^http:\/\/localhost:[0-9]{4,5}$/.test(wrapperOrigin)
)
  throw new Error(
    "Enable only the qualified local 127.0.0.1 app / localhost wrapper pair.",
  );
const app = new URL(appOrigin);
const wrapper = new URL(wrapperOrigin);
if (
  app.origin !== appOrigin ||
  wrapper.origin !== wrapperOrigin ||
  Number(app.port) < 1024 ||
  Number(wrapper.port) < 1024
)
  throw new Error("Use canonical local origins with ports from 1024 to 65535.");

const server = http.createServer(
  { maxHeaderSize: 8192 },
  (request, response) => {
    const headers = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src https://platform.instagram.com/en_US/embeds.js https://www.instagram.com/embed.js; frame-src https://www.instagram.com; style-src 'unsafe-inline'; img-src https: data:; connect-src https://www.instagram.com https://platform.instagram.com; base-uri 'none'; form-action 'none'; frame-ancestors ${appOrigin}`,
    };
    // No cookies are issued, consumed, logged or forwarded. This is not an app route.
    if (
      request.method !== "GET" ||
      request.headers.host !== wrapper.host ||
      request.headers.cookie ||
      (request.headers.origin && request.headers.origin !== appOrigin) ||
      !request.url ||
      request.url.length > 512
    ) {
      response.writeHead(400, headers);
      response.end(
        "Display unavailable. Use the original source link in the app.",
      );
      return;
    }
    const url = new URL(request.url, wrapperOrigin);
    const source = url.searchParams.get("source");
    if (
      url.pathname !== "/display" ||
      [...url.searchParams.keys()].length !== 1 ||
      !source ||
      !/^https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]{1,64}\/$/.test(
        source,
      )
    ) {
      response.writeHead(400, headers);
      response.end("Unsupported public Instagram permalink.");
      return;
    }
    response.writeHead(200, headers);
    // Only regex-constrained public URLs enter this technical display template.
    // The official script constructs the provider frame; no /embed/ URL is guessed.
    response.end(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Isolated Instagram preview</title><style>body{margin:8px;font:16px system-ui}blockquote{max-width:540px;margin:auto}iframe{max-width:100%}</style><blockquote class="instagram-media" data-instgrm-captioned data-instgrm-permalink="${source}" data-instgrm-version="14"><a href="${source}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">View this post on Instagram</a></blockquote><script async src="https://platform.instagram.com/en_US/embeds.js"></script></html>`,
    );
  },
);
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.keepAliveTimeout = 2000;
server.listen(Number(wrapper.port), "::1", () => {
  console.log(
    `Local optional Instagram wrapper: ${wrapperOrigin} (IPv6 loopback only)`,
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
