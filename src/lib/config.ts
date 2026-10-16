export class ConfigError extends Error {
  readonly missing: string;
  constructor(missing: string) {
    super(`Missing configuration: ${missing}`);
    this.name = "ConfigError";
    this.missing = missing;
  }
}

export type Config = {
  geoapifyKey?: string;
  orsKey?: string;
  /** Without trailing slash, e.g. https://api.heigit.org/openrouteservice */
  orsBaseUrl: string;
  orsDailyCap: number;
  /** Upstash Redis REST endpoint; Vercel's integration sets the KV_* names. */
  redisUrl?: string;
  redisToken?: string;
  openaiKey?: string;
  openaiModel: string;
  llmDailyCap: number;
  wikimediaContact?: string;
  /** Visitors may share TikTok/Instagram/Xiaohongshu post links for places. */
  communityPosts: boolean;
  /**
   * Read the caption of a TikTok link through TikTok's public embed endpoint.
   * Off by default: review TikTok's terms before switching it on.
   */
  tiktokOembed: boolean;
};

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Reads server-side settings. Never import this from a client component. */
export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cap = Number.parseInt(env.LLM_DAILY_CAP ?? "", 10);
  const orsCap = Number.parseInt(env.ORS_DAILY_CAP ?? "", 10);
  return {
    geoapifyKey: clean(env.GEOAPIFY_API_KEY),
    orsKey: clean(env.ORS_API_KEY),
    orsBaseUrl: (
      clean(env.ORS_BASE_URL) ?? "https://api.heigit.org/openrouteservice"
    ).replace(/\/+$/, ""),
    // The free plan allows ~2,000 directions/day; stay well below it.
    orsDailyCap: Number.isFinite(orsCap) && orsCap >= 0 ? orsCap : 1200,
    redisUrl: clean(env.UPSTASH_REDIS_REST_URL) ?? clean(env.KV_REST_API_URL),
    redisToken:
      clean(env.UPSTASH_REDIS_REST_TOKEN) ?? clean(env.KV_REST_API_TOKEN),
    openaiKey: clean(env.OPENAI_API_KEY),
    openaiModel: clean(env.OPENAI_MODEL) ?? "gpt-5.4-mini",
    llmDailyCap: Number.isFinite(cap) && cap >= 0 ? cap : 150,
    wikimediaContact: clean(env.WIKIMEDIA_CONTACT),
    tiktokOembed: ["1", "true", "on"].includes(
      (env.TIKTOK_OEMBED ?? "").trim().toLowerCase(),
    ),
    communityPosts: !["0", "false", "off"].includes(
      (env.COMMUNITY_POSTS ?? "").trim().toLowerCase(),
    ),
  };
}
