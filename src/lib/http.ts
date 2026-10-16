type CachedInit = RequestInit & { next?: { revalidate: number } };

export class UpstreamError extends Error {
  readonly service: string;
  readonly status?: number;
  constructor(service: string, message: string, status?: number) {
    super(`${service}: ${message}`);
    this.name = "UpstreamError";
    this.service = service;
    this.status = status;
  }
}

/**
 * GET JSON with a hard timeout. `revalidate` (seconds) uses Next's server
 * data cache so repeated searches do not spend free-tier quota.
 */
export async function getJson<T>(
  service: string,
  url: string,
  options: {
    headers?: Record<string, string>;
    revalidate?: number;
    timeoutMs?: number;
  } = {},
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
    throw new UpstreamError(service, reason);
  }
  if (!response.ok) {
    throw new UpstreamError(
      service,
      `HTTP ${response.status}`,
      response.status,
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
    throw new UpstreamError(
      service,
      `HTTP ${response.status}`,
      response.status,
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
