import "server-only";
import { importResponse } from "./import-http";
import { ImportFailure } from "./import-policy";
import { ReferenceFailure } from "./social-references";
export function referenceError(error: unknown) {
  const failure =
    error instanceof ReferenceFailure
      ? error
      : error instanceof ImportFailure
        ? new ReferenceFailure(
            error.code,
            error.message,
            error.code === "invalid-origin"
              ? 403
              : error.code === "input-too-large"
                ? 413
                : error.code === "input-timeout"
                  ? 408
                  : error.code === "rate-limited"
                    ? 429
                    : 400,
          )
        : new ReferenceFailure(
            "storage-unavailable",
            "Temporary social drafts are unavailable. Retry explicitly.",
            503,
          );
  return importResponse(
    {
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.status >= 500 || failure.status === 429,
      },
    },
    failure.status,
  );
}
export function missingReference() {
  return importResponse(
    {
      error: {
        code: "not-found",
        message: "Social draft not found in this browser or already expired.",
      },
    },
    404,
  );
}
