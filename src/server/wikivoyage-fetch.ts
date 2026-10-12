import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { createGunzip, createInflate } from "node:zlib";
import ipaddr from "ipaddr.js";
import { ImportFailure, operatorContact } from "./import-policy";

const BYTE_LIMIT = 1024 * 1024;
function publicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return (
      parsed.range() === "unicast" &&
      (parsed.kind() === "ipv4" ||
        (parsed.match(ipaddr.parse("2000::"), 3) &&
          !parsed.match(ipaddr.parse("3fff::"), 20)))
    );
  } catch {
    return false;
  }
}
export type WikiSource = {
  dataKind: "real" | "fixture";
  title: string;
  revid: number;
  wikitext: string;
  capturedAt: string;
};
/** Common external-response gate used by both pinned live transport and authored boundary responses. */
export function validateSourceHeaders(
  status: number,
  headers: Record<string, string | string[] | undefined>,
) {
  if (status >= 300 && status < 400)
    throw new ImportFailure(
      "unsafe-url",
      "Source redirects are disabled; no redirect destination was fetched.",
    );
  const retryHeader = headers["retry-after"];
  const parsedRetry =
    typeof retryHeader === "string"
      ? /^\d+$/.test(retryHeader)
        ? Number(retryHeader)
        : Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000)
      : 60;
  const backoff = Number.isFinite(parsedRetry)
    ? Math.max(1, Math.min(parsedRetry, 86400))
    : 60;
  if (status === 429 || status === 503)
    throw new ImportFailure(
      status === 429 ? "rate-limited" : "provider-unavailable",
      "The source requested a pause. Retry after provider backoff.",
      true,
      false,
      backoff,
    );
  if (status === 401 || status === 403)
    throw new ImportFailure(
      "private-or-auth-required",
      "The source denied access. The app cannot bypass login or permission restrictions.",
      false,
      true,
    );
  if (status === 404)
    throw new ImportFailure(
      "source-unavailable",
      "Source content is unavailable; its cause is unknown.",
    );
  if (status !== 200)
    throw new ImportFailure(
      "provider-unavailable",
      "Source retrieval failed. Retry later.",
      status >= 500,
    );
  if (!/^application\/json(?:;|$)/i.test(String(headers["content-type"] ?? "")))
    throw new ImportFailure(
      "response-invalid",
      "The source did not return the supported JSON format.",
    );
  if (Number(headers["content-length"] ?? 0) > BYTE_LIMIT)
    throw new ImportFailure(
      "input-too-large",
      "Source transfer exceeds the 1 MiB limit.",
    );
  const encoding = String(headers["content-encoding"] ?? "identity");
  if (!["identity", "gzip", "deflate"].includes(encoding))
    throw new ImportFailure(
      "response-invalid",
      "Unsupported source compression.",
    );
  return encoding;
}
export async function retrieveArticle(
  title: string,
  signal: AbortSignal,
): Promise<WikiSource> {
  if (signal.aborted) throw new ImportFailure("cancelled", "Import cancelled.");
  const contact = operatorContact();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  let addresses: Awaited<ReturnType<typeof lookup>>[];
  try {
    addresses = await Promise.race([
      lookup("en.wikivoyage.org", { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        deadline.addEventListener(
          "abort",
          () =>
            reject(
              new ImportFailure(
                "fetch-timeout",
                "Article retrieval timed out. Retry within the shown limits.",
                true,
              ),
            ),
          { once: true },
        ),
      ),
    ]);
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure(
      "network-unavailable",
      "Public source DNS is unavailable. Retry later.",
      true,
    );
  }
  if (
    !addresses.length ||
    addresses.some((answer) => !publicAddress(answer.address))
  )
    throw new ImportFailure(
      "unsafe-url",
      "The source resolved to an unsafe network destination.",
    );
  if (deadline.aborted)
    throw new ImportFailure(
      "fetch-timeout",
      "Article retrieval timed out or was cancelled.",
      true,
    );
  const allowed = new Set(
    addresses.map((answer) => ipaddr.process(answer.address).toString()),
  );
  const endpoint = new URL("https://en.wikivoyage.org/w/api.php");
  endpoint.search = new URLSearchParams({
    action: "parse",
    page: title,
    prop: "wikitext|revid",
    format: "json",
    formatversion: "2",
    maxlag: "5",
  }).toString();
  const payload = await new Promise<string>((resolve, reject) => {
    // Direct HTTPS does not consult HTTP(S)_PROXY. DNS is frozen, SNI/certificate remains the allowlisted hostname.
    const req = request(
      endpoint,
      {
        agent: false,
        servername: "en.wikivoyage.org",
        signal: deadline,
        lookup: (_hostname, options, callback) => {
          const selected = addresses[0];
          if (options.all) callback(null, addresses);
          else callback(null, selected.address, selected.family);
        },
        headers: {
          "User-Agent": `WhereToVisit/0.1 (${contact})`,
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
      },
      (response) => {
        const fail = (failure: ImportFailure) => {
          response.destroy();
          req.destroy();
          reject(failure);
        };
        let encoding: string;
        try {
          encoding = validateSourceHeaders(
            response.statusCode ?? 0,
            response.headers,
          );
        } catch (error) {
          fail(error as ImportFailure);
          return;
        }
        let transferred = 0,
          decoded = 0;
        response.on("data", (chunk: Buffer) => {
          transferred += chunk.length;
          if (transferred > BYTE_LIMIT)
            fail(
              new ImportFailure(
                "input-too-large",
                "Source transfer exceeds the 1 MiB limit.",
              ),
            );
        });
        const stream =
          encoding === "gzip"
            ? response.pipe(createGunzip())
            : encoding === "deflate"
              ? response.pipe(createInflate())
              : response;
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => {
          decoded += chunk.length;
          if (decoded > BYTE_LIMIT) {
            stream.destroy();
            fail(
              new ImportFailure(
                "input-too-large",
                "Decoded source exceeds the 1 MiB limit.",
              ),
            );
          } else chunks.push(chunk);
        });
        stream.on("end", () => {
          try {
            resolve(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks),
              ),
            );
          } catch {
            reject(
              new ImportFailure(
                "response-invalid",
                "Source text has invalid UTF-8.",
              ),
            );
          }
        });
        stream.on("error", () =>
          fail(
            new ImportFailure(
              "response-invalid",
              "Source compression or body is invalid.",
            ),
          ),
        );
        response.on("error", () =>
          reject(
            new ImportFailure(
              "network-unavailable",
              "Source body was interrupted.",
              true,
            ),
          ),
        );
      },
    );
    const connectionTimer = setTimeout(
      () =>
        req.destroy(
          new ImportFailure(
            "fetch-timeout",
            "Source connection timed out.",
            true,
          ),
        ),
      5000,
    );
    req.on("socket", (socket) =>
      socket.once("secureConnect", () => {
        clearTimeout(connectionTimer);
        const peer = socket.remoteAddress;
        if (
          !peer ||
          !publicAddress(peer) ||
          !allowed.has(ipaddr.process(peer).toString())
        )
          req.destroy(
            new ImportFailure(
              "unsafe-url",
              "Source peer did not match validated public DNS.",
            ),
          );
      }),
    );
    req.on("error", (error) => {
      clearTimeout(connectionTimer);
      reject(
        error instanceof ImportFailure
          ? error
          : new ImportFailure(
              deadline.aborted ? "fetch-timeout" : "network-unavailable",
              deadline.aborted
                ? "Source retrieval timed out or was cancelled."
                : "Source connection is unavailable.",
              true,
            ),
      );
    });
    req.end();
  });
  return validateSourcePayload(title, payload);
}
export function validateSourcePayload(
  title: string,
  payload: string,
): WikiSource {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new ImportFailure(
      "response-invalid",
      "Source returned invalid JSON.",
    );
  }
  if (!value || typeof value !== "object")
    throw new ImportFailure(
      "response-invalid",
      "Source response is malformed.",
    );
  const record = value as {
    error?: { code?: unknown };
    parse?: { title?: unknown; revid?: unknown; wikitext?: unknown };
  };
  if (record.error) {
    if (record.error.code === "maxlag" || record.error.code === "ratelimited")
      throw new ImportFailure(
        "rate-limited",
        "The source is busy; retry after provider backoff.",
        true,
        false,
        60,
      );
    if (record.error.code === "missingtitle")
      throw new ImportFailure(
        "source-unavailable",
        "The article is unavailable; deletion or privacy is not established.",
      );
    if (
      record.error.code === "permissiondenied" ||
      record.error.code === "readapidenied"
    )
      throw new ImportFailure(
        "private-or-auth-required",
        "The source denied access; no login bypass is available.",
        false,
        true,
      );
    throw new ImportFailure(
      "response-invalid",
      "Source returned an unsupported API error.",
    );
  }
  const parsed = record.parse;
  if (
    !parsed ||
    typeof parsed.title !== "string" ||
    parsed.title !== title ||
    !Number.isSafeInteger(parsed.revid) ||
    Number(parsed.revid) <= 0 ||
    typeof parsed.wikitext !== "string"
  )
    throw new ImportFailure(
      "response-invalid",
      "Source article title, revision or text did not match the request.",
    );
  if (Array.from(parsed.wikitext).length > 50_000)
    throw new ImportFailure(
      "input-too-large",
      "The article exceeds the 50,000 code point extraction limit.",
    );
  return {
    dataKind: "real",
    title: parsed.title,
    revid: Number(parsed.revid),
    wikitext: parsed.wikitext,
    capturedAt: new Date().toISOString(),
  };
}
