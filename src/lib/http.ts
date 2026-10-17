type CachedInit = RequestInit & { next?: { revalidate: number } };

export class UpstreamError extends Error {
  readonly service: string;
  readonly status?: number;
  /** What the service said was wrong, with any key removed. */
  readonly detail?: string;
  constructor(
    service: string,
    message: string,
    status?: number,
    detail?: string,
  ) {
    super(`${service}: ${message}`);
    this.name = "UpstreamError";
    this.service = service;
    this.status = status;
    this.detail = detail;
  }
}

/** Removes anything that looks like a key or token before text is logged or shown. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(api[_-]?key|key|token|authorization)=([^&\s"']+)/gi, "$1=***")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{32,})\b/g, "***");
}

/** The useful sentence from an error reply, short and safe to show. */
export async function readErrorDetail(
  response: Response,
): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    if (!text) return undefined;
    let message = text;
    try {
      const json = JSON.parse(text) as { message?: unknown; error?: unknown };
      const found = json.message ?? json.error;
      if (typeof found === "string") message = found;
      else if (
        found &&
        typeof (found as { message?: unknown }).message === "string"
      ) {
        message = (found as { message: string }).message;
      }
    } catch {
      // not JSON: use the raw text
    }
    return redactSecrets(message).replace(/\s+/g, " ").slice(0, 240);
  } catch {
    return undefined;
  }
}

/** Failures that are worth one more try: slow or dropped connections, rate limits, server errors. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return false;
  return (
    error.status === undefined || error.status === 429 || error.status >= 500
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET JSON with a hard timeout. `revalidate` (seconds) uses Next's server
 * data cache so repeated searches do not spend free-tier quota. With
 * `retries`, rate-limit, server and connection failures are tried again.
 */
export async function getJson<T>(
  service: string,
  url: string,
  options: {
    headers?: Record<string, string>;
    revalidate?: number;
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
  } = {},
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 0);
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJsonOnce<T>(service, url, options);
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      await sleep((options.retryDelayMs ?? 700) * (attempt + 1));
    }
  }
}

async function getJsonOnce<T>(
  service: string,
  url: string,
  options: {
    headers?: Record<string, string>;
    revalidate?: number;
    timeoutMs?: number;
  },
): Promise<T> {
  const init: CachedInit = {
    headers: { accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(options.timeoutMs ?? 12000),
    ...(options.revalidate ? { next: { revalidate: options.revalidate } } : {}),
  };
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed";
    throw new UpstreamError(service, redactSecrets(reason));
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new UpstreamError(
      service,
      `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      response.status,
      detail,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(service, "invalid JSON response");
  }
}

/** POST JSON with a hard timeout; never cached. */
export async function postJson<T>(
  service: string,
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, application/geo+json",
        "content-type": "application/json",
        ...options.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed";
    throw new UpstreamError(service, reason);
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new UpstreamError(
      service,
      `HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      response.status,
      detail,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(service, "invalid JSON response");
  }
}

/** Fixed-window counters used for rate limits and daily caps (per process). */
export class WindowCounter {
  private readonly windowMs: number;
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  /** Returns true when the call is allowed and records it. */
  take(key: string, limit: number, now = Date.now()): boolean {
    if (limit <= 0) return false;
    if (this.hits.size > 5000) this.prune(now);
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) {
      if (now - entry.start >= this.windowMs) this.hits.delete(key);
    }
  }
}

/** Small TTL cache for results that are expensive to recompute. */
export class TtlCache<V> {
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly entries = new Map<string, { value: V; expires: number }>();

  constructor(ttlMs: number, max = 500) {
    this.ttlMs = ttlMs;
    this.max = max;
  }

  get(key: string, now = Date.now()): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, now = Date.now()) {
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expires: now + this.ttlMs });
  }
}

export type FailureReason = "key-rejected" | "quota" | "unavailable";

/** Turns an upstream failure into a reason the interface can explain. */
export function failureReason(error: unknown): FailureReason {
  if (error instanceof UpstreamError) {
    if (error.status === 401 || error.status === 403) return "key-rejected";
    if (error.status === 429) return "quota";
  }
  return "unavailable";
}

/** Resolves with `fallback` if the promise takes longer than `ms`. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
