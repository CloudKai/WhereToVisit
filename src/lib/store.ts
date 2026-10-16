import type { Config } from "./config.ts";

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** The small key-value surface the voting feature needs. */
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Returns true if the key was created, false if it already existed. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Sets a hash field and refreshes the hash's expiry. */
  hset(
    key: string,
    field: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  hlen(key: string): Promise<number>;
  del(keys: string[]): Promise<void>;
  expire(keys: string[], ttlSeconds: number): Promise<void>;
  /** Atomically increments a counter; the first increment starts the TTL. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

// ---------- in-memory (local development and tests) ----------

type Entry =
  | { kind: "string"; value: string; expires: number }
  | { kind: "hash"; value: Map<string, string>; expires: number };

export class MemoryStore implements Store {
  private readonly data = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private live(key: string): Entry | undefined {
    const entry = this.data.get(key);
    if (entry && entry.expires <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  private expiry(ttlSeconds: number): number {
    return this.now() + ttlSeconds * 1000;
  }

  async get(key: string) {
    const entry = this.live(key);
    return entry?.kind === "string" ? entry.value : null;
  }

  async set(key: string, value: string, ttl: number) {
    this.data.set(key, { kind: "string", value, expires: this.expiry(ttl) });
  }

  async setIfAbsent(key: string, value: string, ttl: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttl);
    return true;
  }

  private hash(key: string, ttl: number): Map<string, string> {
    const entry = this.live(key);
    if (entry?.kind === "hash") {
      entry.expires = this.expiry(ttl);
      return entry.value;
    }
    const value = new Map<string, string>();
    this.data.set(key, { kind: "hash", value, expires: this.expiry(ttl) });
    return value;
  }

  async hset(key: string, field: string, value: string, ttl: number) {
    this.hash(key, ttl).set(field, value);
  }

  async hdel(key: string, field: string) {
    const entry = this.live(key);
    if (entry?.kind === "hash") entry.value.delete(field);
  }

  async hgetall(key: string) {
    const entry = this.live(key);
    return entry?.kind === "hash" ? Object.fromEntries(entry.value) : {};
  }

  async hlen(key: string) {
    const entry = this.live(key);
    return entry?.kind === "hash" ? entry.value.size : 0;
  }

  async del(keys: string[]) {
    for (const key of keys) this.data.delete(key);
  }

  async expire(keys: string[], ttl: number) {
    for (const key of keys) {
      const entry = this.live(key);
      if (entry) entry.expires = this.expiry(ttl);
    }
  }

  async incr(key: string, ttl: number) {
    const entry = this.live(key);
    if (entry?.kind === "string") {
      const next = Number(entry.value) + 1;
      entry.value = String(next);
      return next;
    }
    await this.set(key, "1", ttl);
    return 1;
  }
}

// ---------- Upstash Redis over HTTP (Vercel, AWS, anywhere) ----------

type Command = (string | number)[];
type RestReply = { result?: unknown; error?: string };

/** HGETALL replies with [field, value, field, value, ...]; some servers send an object. */
export function parseHashReply(result: unknown): Record<string, string> {
  if (Array.isArray(result)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < result.length; i += 2) {
      out[String(result[i])] = String(result[i + 1]);
    }
    return out;
  }
  if (result && typeof result === "object") {
    return Object.fromEntries(
      Object.entries(result as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
  }
  return {};
}

export class UpstashStore implements Store {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async send(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
    } catch (error) {
      throw new StorageError(
        error instanceof Error ? error.message : "storage request failed",
      );
    }
    if (!response.ok) throw new StorageError(`storage HTTP ${response.status}`);
    return response.json();
  }

  private async command(args: Command): Promise<unknown> {
    const reply = (await this.send("", args)) as RestReply;
    if (reply.error) throw new StorageError(reply.error);
    return reply.result;
  }

  private async pipeline(commands: Command[]): Promise<unknown[]> {
    const replies = (await this.send("/pipeline", commands)) as RestReply[];
    if (!Array.isArray(replies) || replies.length !== commands.length) {
      throw new StorageError("unexpected storage reply");
    }
    for (const reply of replies) {
      if (reply.error) throw new StorageError(reply.error);
    }
    return replies.map((reply) => reply.result);
  }

  async get(key: string) {
    const result = await this.command(["GET", key]);
    return typeof result === "string" ? result : null;
  }

  async set(key: string, value: string, ttl: number) {
    await this.command(["SET", key, value, "EX", ttl]);
  }

  async setIfAbsent(key: string, value: string, ttl: number) {
    return (await this.command(["SET", key, value, "EX", ttl, "NX"])) === "OK";
  }

  async hset(key: string, field: string, value: string, ttl: number) {
    await this.pipeline([
      ["HSET", key, field, value],
      ["EXPIRE", key, ttl],
    ]);
  }

  async hdel(key: string, field: string) {
    await this.command(["HDEL", key, field]);
  }

  async hgetall(key: string) {
    return parseHashReply(await this.command(["HGETALL", key]));
  }

  async hlen(key: string) {
    const result = await this.command(["HLEN", key]);
    return typeof result === "number" ? result : 0;
  }

  async del(keys: string[]) {
    if (keys.length > 0) await this.command(["DEL", ...keys]);
  }

  async expire(keys: string[], ttl: number) {
    if (keys.length === 0) return;
    await this.pipeline(keys.map((key) => ["EXPIRE", key, ttl] as Command));
  }

  async incr(key: string, ttl: number) {
    const [count] = await this.pipeline([["INCR", key]]);
    const value = typeof count === "number" ? count : Number(count);
    if (value === 1) await this.command(["EXPIRE", key, ttl]);
    return value;
  }
}

// ---------- selection ----------

export type StorageMode = "redis" | "memory" | "none";

export function storageMode(
  config: Pick<Config, "redisUrl" | "redisToken">,
  nodeEnv: string | undefined,
): StorageMode {
  if (config.redisUrl && config.redisToken) return "redis";
  // Memory is per-process: fine for `next dev`, wrong for serverless hosting.
  return nodeEnv === "production" ? "none" : "memory";
}

const globalStore = globalThis as { __wtvStore?: Store };

/** Returns the shared store, or null when sharing is not available. */
export function getStore(
  config: Pick<Config, "redisUrl" | "redisToken">,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Store | null {
  const mode = storageMode(config, nodeEnv);
  if (mode === "none") return null;
  if (!globalStore.__wtvStore) {
    globalStore.__wtvStore =
      mode === "redis" && config.redisUrl && config.redisToken
        ? new UpstashStore(config.redisUrl, config.redisToken)
        : new MemoryStore();
  }
  return globalStore.__wtvStore;
}
