"use client";
import { useState } from "react";
import {
  countByPlatform,
  PLATFORM_LABEL,
  socialSearchLinks,
} from "@/lib/social";
import { type PlaceRef, useSocial } from "./social-provider";

/** Small "TikTok ×2" chips: posts visitors shared. Shows nothing when there are none. */
export function SocialBadges({ place }: { place: PlaceRef }) {
  const social = useSocial();
  const counts = social ? countByPlatform(social.postsFor(place)) : [];
  if (counts.length === 0) return null;
  return (
    <ul
      className="chips social-chips"
      aria-label="Posts shared by visitors"
      title="Links visitors shared for this place. We haven't checked them."
    >
      {counts.map(({ platform, count }) => (
        <li key={platform} className={`social-chip social-${platform}`}>
          Seen on {PLATFORM_LABEL[platform]}
          {count > 1 ? ` ×${count}` : ""}
        </li>
      ))}
    </ul>
  );
}

/** Look the place up on each app, see links visitors shared, and share one. */
export function SocialPanel({
  place,
  city,
}: {
  place: PlaceRef & { localName?: string };
  city: string;
}) {
  const social = useSocial();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [reported, setReported] = useState<Record<string, string>>({});

  const posts = social?.postsFor(place) ?? [];
  const canShare =
    social?.status === "ready" &&
    place.lat !== undefined &&
    place.lon !== undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!social || busy || !url.trim()) return;
    setBusy(true);
    setMessage(undefined);
    const problem = await social.share(place, url.trim());
    setBusy(false);
    if (problem) {
      setMessage({ ok: false, text: problem });
    } else {
      setUrl("");
      setMessage({ ok: true, text: "Thanks — your link was added." });
    }
  }

  return (
    <details className="social">
      <summary>
        Social posts &amp; search
        {posts.length > 0 && ` (${posts.length})`}
      </summary>

      <p className="social-heading">Look it up on</p>
      <div className="map-links">
        {socialSearchLinks(place, city).map((link) => (
          <a
            key={link.platform}
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {link.label}
          </a>
        ))}
      </div>
      <p className="hint">
        These open each app’s own search. We can’t see or check what they show.
      </p>

      {social?.status === "ready" && posts.length > 0 && (
        <>
          <p className="social-heading">Shared by visitors</p>
          <ul className="social-posts">
            {posts.map((post) => (
              <li key={post.id}>
                <span className={`social-chip social-${post.platform}`}>
                  {PLATFORM_LABEL[post.platform]}
                </span>
                <a href={post.url} target="_blank" rel="noreferrer noopener">
                  Open post ↗
                </a>
                {reported[post.id] ? (
                  <span className="hint">{reported[post.id]}</span>
                ) : (
                  <button
                    type="button"
                    className="text-button"
                    onClick={async () => {
                      const problem = await social.report(place, post);
                      setReported((r) => ({
                        ...r,
                        [post.id]: problem ?? "Reported — thanks.",
                      }));
                    }}
                  >
                    Report
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="hint">
            Links people shared. We haven’t checked that they are about this
            place, or that they are popular.
          </p>
        </>
      )}

      {canShare && (
        <form className="social-form" onSubmit={submit}>
          <label htmlFor={`share-${place.name}`} className="social-heading">
            Share a post about this place
          </label>
          <div className="share-row">
            <input
              id={`share-${place.name}`}
              type="url"
              inputMode="url"
              placeholder="Paste a TikTok, Instagram or Xiaohongshu post link"
              value={url}
              maxLength={300}
              onChange={(event) => setUrl(event.target.value)}
            />
            <button
              type="submit"
              className="button secondary"
              disabled={busy || !url.trim()}
            >
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
          <p className="hint">
            One video or post per link. Please share only posts about this
            place; others can report links that aren’t.
          </p>
          {message && (
            <p
              className={message.ok ? "hint" : "notice"}
              role={message.ok ? "status" : "alert"}
            >
              {message.text}
            </p>
          )}
        </form>
      )}
    </details>
  );
}
