import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { CATEGORIES } from "@/lib/categories";
import { placesRequestUrl } from "@/lib/geoapify";
import { readErrorDetail } from "@/lib/http";
import { storageMode } from "@/lib/store";

/**
 * Development-only health check: which services are configured and whether
 * each one answers. It never returns a key, and is disabled in production.
 */
type Check = { configured: boolean; ok?: boolean; detail: string };

async function probe(
  run: () => Promise<Response>,
  okText: string,
): Promise<Pick<Check, "ok" | "detail">> {
  try {
    const response = await run();
    if (response.ok) return { ok: true, detail: okText };
    const hint =
      response.status === 401 || response.status === 403
        ? " — the key was rejected (check it is copied exactly, with no quotes or spaces)"
        : response.status === 429
          ? " — rate or daily limit reached"
          : response.status === 404
            ? " — not found (wrong URL or model name)"
            : "";
    return { ok: false, detail: `HTTP ${response.status}${hint}` };
  } catch (error) {
    return {
      ok: false,
      detail: `couldn’t connect: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const config = getConfig();
  const timeout = () => AbortSignal.timeout(8000);
  const result: Record<string, Check> = {};

  result.geoapify = config.geoapifyKey
    ? {
        configured: true,
        ...(await probe(
          () =>
            fetch(
              `https://api.geoapify.com/v1/geocode/autocomplete?text=Shanghai&limit=1&apiKey=${encodeURIComponent(config.geoapifyKey as string)}`,
              { signal: timeout(), cache: "no-store" },
            ),
          "search and places key works",
        )),
      }
    : {
        configured: false,
        detail: "GEOAPIFY_API_KEY is not set in .env.local",
      };

  // Run the exact requests a real search makes (same address, same size, three
  // at a time) for Shanghai, and say how long each took and what went wrong.
  if (config.geoapifyKey) {
    const key = config.geoapifyKey;
    const where = { lat: 31.2304, lon: 121.4737, radiusM: 5000 };
    const one = async (category: (typeof CATEGORIES)[number]) => {
      const started = Date.now();
      try {
        const response = await fetch(placesRequestUrl(where, key, category), {
          signal: AbortSignal.timeout(25000),
          cache: "no-store",
        });
        const ms = Date.now() - started;
        if (response.ok) {
          const data = (await response.json()) as { features?: unknown[] };
          return [
            category,
            {
              configured: true,
              ok: true,
              detail: `${data.features?.length ?? 0} places in ${ms} ms`,
            },
          ] as const;
        }
        const said = await readErrorDetail(response);
        return [
          category,
          {
            configured: true,
            ok: false,
            detail: `HTTP ${response.status} after ${ms} ms${said ? ` — Geoapify said: ${said}` : ""}`,
          },
        ] as const;
      } catch (error) {
        return [
          category,
          {
            configured: true,
            ok: false,
            detail: `${error instanceof Error ? error.message : "failed"} after ${Date.now() - started} ms (a timeout here would explain "could not be loaded")`,
          },
        ] as const;
      }
    };
    const started = Date.now();
    const rows: (readonly [(typeof CATEGORIES)[number], Check])[] = [];
    for (let i = 0; i < CATEGORIES.length; i += 3) {
      rows.push(...(await Promise.all(CATEGORIES.slice(i, i + 3).map(one))));
    }
    for (const [category, check] of rows) {
      result[`real search · ${category}`] = check;
    }
    const failed = rows.filter(([, c]) => !c.ok).length;
    result["real search · summary"] = {
      configured: true,
      ok: failed === 0,
      detail:
        failed === 0
          ? `all ${rows.length} place requests worked, ${Date.now() - started} ms in total`
          : `${failed} of ${rows.length} place requests failed — see the lines above`,
    };
  }

  // "From links" looks place names up with Geoapify's geocoder, a different endpoint.
  if (config.geoapifyKey) {
    result["geoapify · find a place by name"] = {
      configured: true,
      ...(await probe(
        () =>
          fetch(
            `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent("Yu Garden, Shanghai")}&limit=1&apiKey=${encodeURIComponent(config.geoapifyKey as string)}`,
            { signal: timeout(), cache: "no-store" },
          ),
        "used by the From links page",
      )),
    };
  }

  result["feature switches"] = {
    configured: true,
    ok: true,
    detail: `shared links ${config.communityPosts ? "on" : "off"} (COMMUNITY_POSTS) · TikTok caption reading ${config.tiktokOembed ? "on" : "off"} (TIKTOK_OEMBED)`,
  };

  result.wikidataImages = {
    configured: true,
    ...(await probe(
      () =>
        fetch(
          `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent("SELECT ?i WHERE { VALUES ?i { wd:Q8686 } ?i wdt:P18 ?img }")}`,
          {
            signal: timeout(),
            cache: "no-store",
            headers: { "user-agent": "WhereToVisit/0.2 (status check)" },
          },
        ),
      "place photos (Wikidata) reachable",
    )),
  };

  result.commonsPhotos = {
    configured: true,
    ...(await probe(
      () =>
        fetch(
          "https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=31.2397|121.4998&gsradius=100&gsnamespace=6&gslimit=1&format=json",
          {
            signal: timeout(),
            cache: "no-store",
            headers: { "user-agent": "WhereToVisit/0.2 (status check)" },
          },
        ),
      "nearby photos (Wikimedia Commons) reachable",
    )),
  };

  result.wikivoyage = {
    configured: true,
    ...(await probe(
      () =>
        fetch(
          "https://en.wikivoyage.org/w/api.php?action=query&list=geosearch&gscoord=31.23|121.47&gsradius=5000&gslimit=1&format=json",
          {
            signal: timeout(),
            cache: "no-store",
            headers: { "user-agent": "WhereToVisit/0.2 (status check)" },
          },
        ),
      "editor recommendations reachable",
    )),
  };

  result.openrouteservice = config.orsKey
    ? {
        configured: true,
        ...(await probe(
          () =>
            fetch(`${config.orsBaseUrl}/v2/directions/foot-walking/geojson`, {
              method: "POST",
              signal: timeout(),
              cache: "no-store",
              headers: {
                authorization: config.orsKey as string,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                coordinates: [
                  [121.4737, 31.2304],
                  [121.4781, 31.2333],
                ],
              }),
            }),
          "routing works",
        )),
      }
    : {
        configured: false,
        detail:
          "ORS_API_KEY is not set — day plans will use straight-line estimates",
      };

  result.openai = config.openaiKey
    ? {
        configured: true,
        ...(await probe(
          () =>
            fetch(
              `https://api.openai.com/v1/models/${encodeURIComponent(config.openaiModel)}`,
              {
                signal: timeout(),
                cache: "no-store",
                headers: { authorization: `Bearer ${config.openaiKey}` },
              },
            ),
          `model “${config.openaiModel}” is available`,
        )),
      }
    : {
        configured: false,
        detail:
          "OPENAI_API_KEY is not set — long notes stay as plain text (fine)",
      };

  const mode = storageMode(config, process.env.NODE_ENV);
  result.voting = {
    configured: mode === "redis",
    ok: mode !== "none",
    detail:
      mode === "redis"
        ? "Redis configured"
        : "no Redis configured — votes are kept in memory (fine for local testing)",
  };

  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
