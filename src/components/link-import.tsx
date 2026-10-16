"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Candidate,
  createLineReader,
  type ExtractCapabilities,
  type ExtractResponse,
  MAX_ENTRIES,
  MAX_HINT_LENGTH,
  MAX_IMAGES_PER_ENTRY,
  MAX_IMAGES_TOTAL,
  MAX_TEXT_LENGTH,
  type Mention,
  parseStreamEvent,
  type Progress,
  progressLabel,
  progressPercent,
} from "@/lib/extract-types";
import {
  candidateToStop,
  MAX_STOPS_PER_DAY,
  stopCount,
  type Stop,
} from "@/lib/plan";
import { parseSocialUrl, PLATFORM_LABEL, type Platform } from "@/lib/social";
import { filesToImages, MediaError } from "@/lib/media";
import { MapCanvas, type MapMarker } from "./map";
import { usePlan } from "./plan-provider";

type Post = {
  url: string;
  text: string;
  /** Small JPEG pictures made on this device from screenshots or a recording. */
  images: string[];
};
const STORAGE_KEY = "wtv.links.v1";

/** Pin colour per source, reusing the day colours. */
const PLATFORM_GROUP: Record<Platform | "text", number> = {
  tiktok: 1,
  instagram: 5,
  xiaohongshu: 0,
  text: 3,
};

type Saved = {
  posts: Post[];
  hint: string;
  result: ExtractResponse | null;
  choice: Record<string, number>;
};

function emptyPost(): Post {
  return { url: "", text: "", images: [] };
}

export function LinkImport() {
  const { plan, hydrated, add, remove, dayOf, activeDay, dayFull, tripFull } =
    usePlan();
  const [posts, setPosts] = useState<Post[]>([emptyPost()]);
  const [hint, setHint] = useState("");
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [caps, setCaps] = useState<ExtractCapabilities | null>(null);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [restored, setRestored] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // What this site can read, so hints under each link are accurate.
  useEffect(() => {
    fetch("/api/extract", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ExtractCapabilities | null) => data && setCaps(data))
      .catch(() => undefined);
  }, []);

  // Bring back the last list after visiting the trip page and returning.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Saved>;
        if (Array.isArray(saved.posts) && saved.posts.length > 0) {
          setPosts(
            saved.posts.slice(0, MAX_ENTRIES).map((post) => ({
              url: post.url ?? "",
              text: post.text ?? "",
              images: [],
            })),
          );
        }
        if (typeof saved.hint === "string") setHint(saved.hint);
        if (saved.result) setResult(saved.result);
        if (saved.choice) setChoice(saved.choice);
      }
    } catch {
      // damaged or unavailable storage: start fresh
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      const saved: Saved = {
        posts: posts.map((post) => ({ ...post, images: [] })),
        hint,
        result,
        choice,
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // storage can be unavailable; the page still works
    }
  }, [restored, posts, hint, result, choice]);

  function update(index: number, change: Partial<Post>) {
    setPosts((current) =>
      current.map((post, i) => (i === index ? { ...post, ...change } : post)),
    );
  }

  const [picking, setPicking] = useState<number | null>(null);
  const [pickError, setPickError] = useState<{ row: number; text: string }>();
  const totalImages = posts.reduce((n, p) => n + p.images.length, 0);

  /** Turn chosen screenshots or a recording into small pictures, on this device. */
  async function addMedia(index: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = Math.min(
      MAX_IMAGES_PER_ENTRY - posts[index].images.length,
      MAX_IMAGES_TOTAL - totalImages,
    );
    setPickError(undefined);
    if (room <= 0) {
      setPickError({
        row: index,
        text: `You can add up to ${MAX_IMAGES_PER_ENTRY} pictures per post (${MAX_IMAGES_TOTAL} in total).`,
      });
      return;
    }
    setPicking(index);
    try {
      const made = await filesToImages([...files], room);
      setPosts((current) =>
        current.map((post, i) =>
          i === index ? { ...post, images: [...post.images, ...made] } : post,
        ),
      );
    } catch (e) {
      setPickError({
        row: index,
        text:
          e instanceof MediaError
            ? e.message
            : "Those files couldn’t be prepared. Try screenshots saved as PNG or JPEG.",
      });
    } finally {
      setPicking(null);
    }
  }

  const filled = posts.filter(
    (p) => p.url.trim() || p.text.trim() || p.images.length > 0,
  );
  // Every post needs a valid link; the caption is optional.
  const missingLink = filled.some((p) => !parseSocialUrl(p.url));
  const canSubmit =
    filled.length > 0 && !missingLink && !busy && picking === null;

  async function find(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    setProgress({ phase: "reading", done: 0, total: filled.length });
    let finished: ExtractResponse | null = null;
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: filled,
          hint: hint.trim() || undefined,
        }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Something went wrong. Try again.");
      }
      // The server reports each stage as it finishes, one JSON line at a time.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const lines = createLineReader();
      const handle = (line: string) => {
        const event = parseStreamEvent(line);
        if (!event) return;
        if (event.type === "progress") setProgress(event.progress);
        else if (event.type === "result") finished = event.data;
        else throw new Error(event.message);
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of lines.push(
          decoder.decode(value, { stream: true }),
        )) {
          handle(line);
        }
      }
      for (const line of lines.flush()) handle(line);

      if (!finished) throw new Error("The search ended early. Try again.");
      setResult(finished);
      setChoice({});
      setSelected(undefined);
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        50,
      );
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Can’t reach the server. Check your connection and try again."
          : e instanceof Error
            ? e.message
            : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // ---------- the places found ----------
  const mentions = result?.mentions ?? [];
  const entries = result?.entries ?? [];

  function chosen(m: Mention): Candidate | null {
    const index = choice[m.id] ?? (m.candidates.length > 0 ? 0 : -1);
    return m.candidates[index] ?? null;
  }

  /** Earlier posts that point at the same spot, so a place is not counted twice. */
  function alsoIn(m: Mention): number[] {
    const here = chosen(m);
    if (!here) return [];
    const stop = candidateToStop(here);
    return mentions
      .filter((o) => o.id !== m.id)
      .filter((o) => {
        const c = chosen(o);
        const other = c ? candidateToStop(c) : null;
        return other && stop && other.id === stop.id;
      })
      .map((o) => o.entry + 1)
      .filter((n, i, all) => n !== m.entry + 1 && all.indexOf(n) === i);
  }

  function sourceOf(m: Mention) {
    return entries[m.entry]?.source;
  }

  const pins = useMemo(() => {
    const seen = new Set<string>();
    const out: (MapMarker & { stop: Stop })[] = [];
    mentions.forEach((m) => {
      const c = chosen(m);
      const stop = c ? candidateToStop(c) : null;
      if (!c || !stop || seen.has(stop.id)) return;
      seen.add(stop.id);
      out.push({
        id: stop.id,
        lat: c.lat,
        lon: c.lon,
        label: `${out.length + 1}. ${m.name}`,
        kind: "stop",
        badge: String(out.length + 1),
        group: PLATFORM_GROUP[entries[m.entry]?.source?.platform ?? "text"],
        stop,
      });
    });
    return out;
    // `chosen` reads `choice`; the memo must update when it changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: chosen is derived from choice and mentions
  }, [mentions, choice, entries]);

  const numberOf = (stopId: string) =>
    pins.findIndex((p) => p.id === stopId) + 1;
  const addable = pins.filter((p) => dayOf(p.id) < 0);
  const room = Math.max(
    0,
    MAX_STOPS_PER_DAY - (plan.days[activeDay]?.stops.length ?? 0),
  );

  function addAll() {
    for (const pin of addable.slice(0, room))
      add(pin.stop, hint.trim() || undefined);
  }

  function select(stopId: string) {
    setSelected(stopId);
    const card = document.querySelector(`[data-stop="${CSS.escape(stopId)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const legend = useMemo(() => {
    const used = new Set<Platform | "text">();
    for (const m of mentions)
      used.add(entries[m.entry]?.source?.platform ?? "text");
    return [...used];
  }, [mentions, entries]);

  return (
    <div className="page-section links-page">
      <header className="explore-head">
        <p className="eyebrow">From links</p>
        <h1>Turn posts into places</h1>
        <p className="lead">
          Add the TikTok, Instagram or Xiaohongshu posts you’ve saved. We find
          the places they mention, show them on a map, and you add the ones you
          want to your trip.
        </p>
      </header>

      <form className="links-form" onSubmit={find} noValidate>
        <p className="hint links-honest">
          <strong>How it works:</strong> add the link to each post — it’s kept
          as your <em>source</em>. Instagram and Xiaohongshu don’t let other
          apps read posts, so to find places in them, also paste the caption (or
          type the place names, one per line). The caption is optional, but
          without it there is nothing for us to search.
        </p>

        <fieldset className="form-lock" disabled={busy}>
          {posts.map((post, index) => {
            const platform = post.url.trim()
              ? parseSocialUrl(post.url)?.platform
              : undefined;
            const bad = post.url.trim() && !platform;
            const noLink =
              !post.url.trim() && (post.text.trim() || post.images.length > 0);
            const noCaption =
              platform && !post.text.trim() && post.images.length === 0;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no identity
              <fieldset className="post-row" key={index}>
                <legend>
                  Post {index + 1}
                  {platform && (
                    <span className={`social-chip social-${platform}`}>
                      {PLATFORM_LABEL[platform]}
                    </span>
                  )}
                </legend>
                <label className="visually-hidden" htmlFor={`url-${index}`}>
                  Link to post {index + 1}
                </label>
                <input
                  id={`url-${index}`}
                  type="url"
                  inputMode="url"
                  placeholder="Link to the post (required)"
                  value={post.url}
                  maxLength={300}
                  required={Boolean(post.text.trim() || post.images.length > 0)}
                  aria-invalid={bad || noLink ? "true" : undefined}
                  onChange={(event) =>
                    update(index, { url: event.target.value })
                  }
                />
                {bad && (
                  <p className="hint form-error" role="alert">
                    That isn’t a link to a single TikTok, Instagram or
                    Xiaohongshu post.
                  </p>
                )}
                {noLink && (
                  <p className="hint form-error" role="alert">
                    Add the link to this post. A caption or screenshots on their
                    own aren’t enough.
                  </p>
                )}
                <label className="visually-hidden" htmlFor={`text-${index}`}>
                  Caption or place names for post {index + 1}
                </label>
                <textarea
                  id={`text-${index}`}
                  rows={3}
                  placeholder="Caption or place names — optional, one per line"
                  value={post.text}
                  maxLength={MAX_TEXT_LENGTH}
                  onChange={(event) =>
                    update(index, { text: event.target.value })
                  }
                />
                <div className="media-picker">
                  <label className="button secondary media-button">
                    {picking === index
                      ? "Preparing pictures…"
                      : post.images.length > 0
                        ? "+ Add more screenshots"
                        : "+ Upload screenshots or a screen recording"}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="visually-hidden"
                      disabled={picking !== null || busy}
                      onChange={(event) => {
                        void addMedia(index, event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {post.images.length > 0 && (
                    <ul
                      className="thumbs"
                      aria-label={`Pictures for post ${index + 1}`}
                    >
                      {post.images.map((src, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: small, ordered list of local previews
                        <li key={i}>
                          {/* biome-ignore lint/performance/noImgElement: local preview of a picture the person chose */}
                          <img
                            src={src}
                            alt={`Picture ${i + 1} for post ${index + 1}`}
                          />
                          <button
                            type="button"
                            aria-label={`Remove picture ${i + 1} from post ${index + 1}`}
                            onClick={() =>
                              update(index, {
                                images: post.images.filter((_, j) => j !== i),
                              })
                            }
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {pickError?.row === index && (
                  <p className="hint form-error" role="alert">
                    {pickError.text}
                  </p>
                )}
                {caps && !caps.images && post.images.length > 0 && (
                  <p className="hint form-error">
                    Reading pictures needs an OpenAI key on this site, so these
                    won’t be used.
                  </p>
                )}
                {noCaption && (
                  <p className="hint">
                    {platform === "tiktok"
                      ? caps?.tiktokCaptions
                        ? "We’ll try to read this TikTok’s caption. If that fails, add it here."
                        : "TikTok captions aren’t read automatically here. Add the caption to find places."
                      : `${PLATFORM_LABEL[platform]} doesn’t let other apps read posts. Add the caption to find places.`}
                  </p>
                )}
                {posts.length > 1 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setPosts((c) => c.filter((_, i) => i !== index))
                    }
                  >
                    Remove post {index + 1}
                  </button>
                )}
              </fieldset>
            );
          })}

          <div className="links-actions">
            {posts.length < MAX_ENTRIES && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setPosts((c) => [...c, emptyPost()])}
              >
                + Add another post
              </button>
            )}
            <label className="hint-field">
              Where is this?{" "}
              <span className="hint">
                (city or area — helps find the right one)
              </span>
              <input
                type="text"
                placeholder="e.g. Shanghai"
                value={hint}
                maxLength={MAX_HINT_LENGTH}
                onChange={(event) => setHint(event.target.value)}
              />
            </label>
            <button type="submit" className="button" disabled={!canSubmit}>
              {busy ? "Finding places…" : "Find places"}
            </button>
          </div>
        </fieldset>

        {progress && (
          <div className="progress" aria-live="polite">
            <div
              className="progress-bar"
              role="progressbar"
              aria-label="Finding places"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent(progress)}
              aria-valuetext={progressLabel(progress)}
            >
              <div
                className="progress-fill"
                style={{ width: `${progressPercent(progress)}%` }}
              />
            </div>
            <p className="progress-label">
              {progressLabel(progress)}{" "}
              <span className="hint">{progressPercent(progress)}%</span>
            </p>
          </div>
        )}
        <p className="hint">
          Screenshots and recordings are shrunk on your device (a recording is
          never uploaded — only a few still pictures from it). The pictures and
          any text you paste are sent to OpenAI to read, and the place names are
          looked up with Geoapify. Nothing is stored. Crop out anything private,
          such as notifications. We read only the text visible in the pictures;
          we don’t listen to audio or guess places from how a scene looks. Links
          are never opened by us.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
      </form>

      {result && (
        <div ref={resultRef} className="links-results" aria-live="polite">
          <ul className="entry-list">
            {entries.map((entry) => (
              <li key={entry.index} className={`entry entry-${entry.status}`}>
                <strong>Post {entry.index + 1}</strong>
                {entry.source && (
                  <>
                    {" "}
                    <span
                      className={`social-chip social-${entry.source.platform}`}
                    >
                      {PLATFORM_LABEL[entry.source.platform]}
                    </span>{" "}
                    <a
                      href={entry.source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open post ↗
                    </a>
                  </>
                )}
                <span className="entry-message">{entry.message}</span>
              </li>
            ))}
          </ul>
          {result.notes.map((note) => (
            <p key={note} className="notice" role="status">
              {note}
            </p>
          ))}

          {mentions.length > 0 && (
            <>
              <h2>
                {pins.length} {pins.length === 1 ? "place" : "places"} found
              </h2>
              <div className="links-toolbar">
                <button
                  type="button"
                  className="button"
                  onClick={addAll}
                  disabled={addable.length === 0 || room === 0 || tripFull}
                >
                  {addable.length === 0
                    ? "All added to your trip"
                    : `Add ${Math.min(addable.length, room)} to ${plan.days.length > 1 ? `Day ${activeDay + 1}` : "my trip"}`}
                </button>
                {hydrated && stopCount(plan) > 0 && (
                  <Link className="button secondary" href="/plan">
                    View your trip ({stopCount(plan)})
                  </Link>
                )}
              </div>

              <div className="plan-layout">
                <div className="plan-map">
                  <MapCanvas
                    markers={pins}
                    label="Map of the places found"
                    selectedId={selected}
                    onSelect={select}
                  />
                  <p className="legend" aria-hidden="true">
                    {legend.map((key) => (
                      <span key={key} className="legend-item">
                        <span
                          className={`legend-dot day-color-${PLATFORM_GROUP[key]}`}
                        />{" "}
                        {key === "text" ? "Typed text" : PLATFORM_LABEL[key]}
                      </span>
                    ))}
                  </p>
                </div>

                <ol className="itinerary found-list">
                  {mentions.map((m) => {
                    const c = chosen(m);
                    const stop = c ? candidateToStop(c) : null;
                    const source = sourceOf(m);
                    const inTrip = stop ? dayOf(stop.id) : -1;
                    const duplicate = stop ? numberOf(stop.id) : 0;
                    return (
                      <li key={m.id} id={`found-${m.id}`} data-stop={stop?.id}>
                        <article
                          className={
                            stop && selected === stop.id
                              ? "stop selected"
                              : "stop"
                          }
                        >
                          <span className="stop-number" aria-hidden="true">
                            {duplicate > 0 ? duplicate : "–"}
                          </span>
                          <div className="stop-main">
                            <h3>{m.name}</h3>
                            <p className="hint">
                              {m.origin === "images" && (
                                <>Read from your pictures by AI — check it. </>
                              )}
                              {source ? (
                                <>
                                  From{" "}
                                  <span
                                    className={`social-chip social-${source.platform}`}
                                  >
                                    {PLATFORM_LABEL[source.platform]}
                                  </span>{" "}
                                  post {m.entry + 1}
                                </>
                              ) : (
                                <>
                                  From the text you typed (post {m.entry + 1})
                                </>
                              )}
                            </p>

                            {alsoIn(m).length > 0 && (
                              <p className="hint">
                                Also mentioned in post
                                {alsoIn(m).length > 1 ? "s" : ""}{" "}
                                {alsoIn(m).join(", ")} — counted once on the
                                map.
                              </p>
                            )}

                            {m.candidates.length === 0 ? (
                              <p className="notice">
                                We couldn’t find this on the map. Try adding the
                                city above, or a more exact name.
                              </p>
                            ) : (
                              <fieldset className="candidates">
                                <legend className="visually-hidden">
                                  Which place is “{m.name}”?
                                </legend>
                                {m.candidates.map((cand, i) => {
                                  const on = (choice[m.id] ?? 0) === i;
                                  return (
                                    <label
                                      key={`${cand.lat},${cand.lon}`}
                                      className={
                                        on ? "candidate on" : "candidate"
                                      }
                                    >
                                      <input
                                        type="radio"
                                        name={`cand-${m.id}`}
                                        checked={on}
                                        onChange={() =>
                                          setChoice((s) => ({
                                            ...s,
                                            [m.id]: i,
                                          }))
                                        }
                                      />
                                      <span>
                                        <strong>{cand.label}</strong>
                                        <span className="hint">
                                          {" "}
                                          {cand.address}
                                        </span>
                                        {cand.approximate && (
                                          <span className="tag-approx">
                                            Approximate — an area or street, not
                                            an exact venue
                                          </span>
                                        )}
                                        {!cand.approximate &&
                                          cand.confidence > 0 &&
                                          cand.confidence < 0.6 && (
                                            <span className="tag-approx">
                                              Check this match
                                            </span>
                                          )}
                                      </span>
                                    </label>
                                  );
                                })}
                                <label
                                  className={
                                    choice[m.id] === -1
                                      ? "candidate on"
                                      : "candidate"
                                  }
                                >
                                  <input
                                    type="radio"
                                    name={`cand-${m.id}`}
                                    checked={choice[m.id] === -1}
                                    onChange={() =>
                                      setChoice((s) => ({ ...s, [m.id]: -1 }))
                                    }
                                  />
                                  <span>None of these</span>
                                </label>
                              </fieldset>
                            )}

                            {stop && (
                              <div className="stop-tools">
                                {inTrip >= 0 ? (
                                  <button
                                    type="button"
                                    className="add-button added"
                                    onClick={() => remove(stop.id)}
                                  >
                                    {plan.days.length > 1
                                      ? `✓ In Day ${inTrip + 1} · remove`
                                      : "✓ In your trip · remove"}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="add-button"
                                    disabled={dayFull || tripFull || !hydrated}
                                    onClick={() =>
                                      add(stop, hint.trim() || undefined)
                                    }
                                  >
                                    {dayFull
                                      ? `Day ${activeDay + 1} is full`
                                      : plan.days.length > 1
                                        ? `+ Add to Day ${activeDay + 1}`
                                        : "+ Add to my trip"}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
