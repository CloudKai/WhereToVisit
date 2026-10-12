import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthConfiguration } from "./config";
import { importSession, SESSION_COOKIE } from "./import-jobs";
import { ImportFailure } from "./import-policy";
export async function requestSession() {
  const session = importSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (session.token)
    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production" &&
        getAuthConfiguration().baseURL.startsWith("https:"),
      path: "/",
      expires: new Date(session.expiresAt),
    });
  return session.digest;
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== getAuthConfiguration().baseURL)
    throw new ImportFailure(
      "invalid-origin",
      "This operation requires the application's own origin.",
    );
}
export function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for") ?? "local-direct";
}
export async function boundedJson(request: Request) {
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new ImportFailure("invalid-request", "Use JSON input.");
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    throw new ImportFailure(
      "input-too-large",
      "Import request exceeds 4096 bytes.",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new ImportFailure("invalid-request", "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  const deadline = setTimeout(() => {
    expired = true;
    void reader.cancel();
  }, 5000);
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 4096) {
        await reader.cancel();
        throw new ImportFailure(
          "input-too-large",
          "Import request exceeds 4096 bytes.",
        );
      }
      chunks.push(next.value);
    }
    if (expired)
      throw new ImportFailure(
        "input-timeout",
        "Import request exceeded the five-second body deadline.",
      );
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure(
      "invalid-request",
      "Use a valid bounded JSON object.",
    );
  } finally {
    clearTimeout(deadline);
  }
}
export function importError(error: unknown) {
  const failure =
    error instanceof ImportFailure
      ? error
      : new ImportFailure(
          "storage-unavailable",
          "Temporary import storage is unavailable.",
          true,
        );
  return NextResponse.json(
    {
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      },
    },
    {
      status:
        failure.code === "invalid-origin"
          ? 403
          : failure.code === "rate-limited"
            ? 429
            : failure.code === "storage-unavailable"
              ? 503
              : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export function importResponse(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
