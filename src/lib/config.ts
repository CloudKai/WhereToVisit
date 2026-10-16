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
  openaiKey?: string;
  openaiModel: string;
  llmDailyCap: number;
  wikimediaContact?: string;
};

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Reads server-side settings. Never import this from a client component. */
export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cap = Number.parseInt(env.LLM_DAILY_CAP ?? "", 10);
  return {
    geoapifyKey: clean(env.GEOAPIFY_API_KEY),
    orsKey: clean(env.ORS_API_KEY),
    openaiKey: clean(env.OPENAI_API_KEY),
    openaiModel: clean(env.OPENAI_MODEL) ?? "gpt-5.4-mini",
    llmDailyCap: Number.isFinite(cap) && cap >= 0 ? cap : 150,
    wikimediaContact: clean(env.WIKIMEDIA_CONTACT),
  };
}
