"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cellsFor, placeKey, type SocialPost } from "@/lib/social";

type Status = "loading" | "ready" | "unavailable";

type Context = {
  status: Status;
  /** Posts shared for a place, newest first. */
  postsFor: (place: PlaceRef) => SocialPost[];
  share: (place: PlaceRef, url: string) => Promise<string | null>;
  report: (place: PlaceRef, post: SocialPost) => Promise<string | null>;
};

export type PlaceRef = { name: string; lat?: number; lon?: number };

const SocialContext = createContext<Context | null>(null);

/** Null when there is no provider, so cards still render (e.g. in tests). */
export function useSocial(): Context | null {
  return useContext(SocialContext);
}

export function keyFor(place: PlaceRef): string | null {
  return place.lat === undefined || place.lon === undefined
    ? null
    : placeKey({ name: place.name, lat: place.lat, lon: place.lon });
}

async function call<T>(
  path: string,
  body?: unknown,
): Promise<
  { ok: true; data: T } | { ok: false; status: number; message: string }
> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: data.error ?? "Something went wrong.",
      };
    }
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      message: "Can’t reach the server. Check your connection.",
    };
  }
}

/**
 * Loads the links visitors shared for the places on screen — one request for
 * the whole page — and lets visitors add or report links.
 */
export function SocialProvider({
  places,
  children,
}: {
  places: PlaceRef[];
  children: React.ReactNode;
}) {
  const [posts, setPosts] = useState<Record<string, SocialPost[]>>({});
  const [status, setStatus] = useState<Status>("loading");

  const cells = useMemo(() => cellsFor(places).join(","), [places]);

  useEffect(() => {
    if (!cells) {
      setStatus("unavailable");
      return;
    }
    let stale = false;
    setStatus("loading");
    call<{ posts: Record<string, SocialPost[]> }>(
      `/api/social?cells=${cells}`,
    ).then((result) => {
      if (stale) return;
      if (result.ok) {
        setPosts(result.data.posts);
        setStatus("ready");
      } else {
        // Not configured, switched off, or a hiccup: the rest of the page is unaffected.
        setStatus("unavailable");
      }
    });
    return () => {
      stale = true;
    };
  }, [cells]);

  const postsFor = useCallback(
    (place: PlaceRef) => {
      const key = keyFor(place);
      return key ? (posts[key] ?? []) : [];
    },
    [posts],
  );

  const share = useCallback(async (place: PlaceRef, url: string) => {
    const key = keyFor(place);
    if (!key) return "This place has no map position, so it can’t be tagged.";
    const result = await call<{ posts: SocialPost[] }>("/api/social", {
      placeKey: key,
      url,
    });
    if (!result.ok) return result.message;
    setPosts((current) => ({ ...current, [key]: result.data.posts }));
    return null;
  }, []);

  const report = useCallback(async (place: PlaceRef, post: SocialPost) => {
    const key = keyFor(place);
    if (!key) return null;
    const result = await call<{ hidden: boolean }>("/api/social/report", {
      placeKey: key,
      postId: post.id,
    });
    if (!result.ok) return result.message;
    if (result.data.hidden) {
      setPosts((current) => ({
        ...current,
        [key]: (current[key] ?? []).filter((p) => p.id !== post.id),
      }));
    }
    return null;
  }, []);

  const value = useMemo<Context>(
    () => ({ status, postsFor, share, report }),
    [status, postsFor, share, report],
  );
  return (
    <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
  );
}
