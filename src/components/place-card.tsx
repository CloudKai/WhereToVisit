import { mapLinks } from "@/lib/maplinks";
import type { Place } from "@/lib/types";

function hueFor(text: string): number {
  let hash = 0;
  for (const char of text)
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hash;
}

function CategoryGlyph({ category }: { category: Place["category"] }) {
  return category === "cafe" ? (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="glyph">
      <path
        d="M10 18h24v10a10 10 0 0 1-10 10h-4A10 10 0 0 1 10 28V18Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M34 21h3a4 4 0 0 1 0 8h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M17 8c-2 3 2 4 0 7M24 8c-2 3 2 4 0 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="glyph">
      <path
        d="M6 24h36a18 18 0 0 1-36 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M16 14c-2 3 2 4 0 7M24 11c-2 3 2 4 0 7M32 14c-2 3 2 4 0 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Media({ place }: { place: Place }) {
  const hue = hueFor(place.name);
  const label = place.category === "cafe" ? "Café" : "Food";
  return (
    <div
      className="card-media"
      style={
        {
          "--h1": hue,
          "--h2": (hue + 42) % 360,
        } as React.CSSProperties
      }
    >
      {place.photo ? (
        // biome-ignore lint/performance/noImgElement: remote Commons thumbnails; no image-optimiser domains configured
        <img
          src={place.photo.url}
          alt={`${place.name} (photo from Wikimedia Commons)`}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <CategoryGlyph category={place.category} />
      )}
      <span className="card-tag">{label}</span>
      {place.photo && (
        <a
          className="photo-credit"
          href={place.photo.pageUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Photo: {place.photo.credit}
        </a>
      )}
    </div>
  );
}

const REASON_LABEL = {
  editor: "Why go",
  community: "Why go",
  facts: "About",
} as const;

function Reason({ place }: { place: Place }) {
  const { reason } = place;
  const credit =
    reason.basis === "editor"
      ? "Wikivoyage travel editors"
      : reason.basis === "community"
        ? "OpenStreetMap contributors"
        : "Map data only — not a recommendation";
  return (
    <div className={`reason reason-${reason.basis}`}>
      <p className="reason-label">
        <strong>{REASON_LABEL[reason.basis]}</strong>
        <span>{credit}</span>
        {reason.polished && (
          <span
            className="ai-tag"
            title="Shortened by an AI model using only the source text below. Read the full note to compare."
          >
            AI-condensed
          </span>
        )}
      </p>
      <p className="reason-text">{reason.text}</p>
      {reason.fullText && (
        <details className="more">
          <summary>Read the full note</summary>
          <p>{reason.fullText}</p>
        </details>
      )}
    </div>
  );
}

export function PlaceCard({ place }: { place: Place }) {
  const hasPoint = place.lat !== undefined && place.lon !== undefined;
  return (
    <article className="card">
      <Media place={place} />
      <div className="card-body">
        <h3>{place.name}</h3>
        {place.localName && (
          <p className="local-name" lang="und">
            {place.localName}
          </p>
        )}
        <ul className="chips" aria-label="Details">
          {place.cuisines.map((cuisine) => (
            <li key={cuisine}>{cuisine}</li>
          ))}
          {place.price && <li>{place.price}</li>}
          {place.distanceKm !== undefined && (
            <li>{place.distanceKm} km from centre</li>
          )}
        </ul>
        <Reason place={place} />
        <details className="visit">
          <summary>Visit details &amp; sources</summary>
          <dl>
            {place.address && (
              <>
                <dt>Address</dt>
                <dd>{place.address}</dd>
              </>
            )}
            <dt>Hours</dt>
            <dd>
              {place.hours ? (
                <>
                  <code>{place.hours}</code>
                  <span className="hint"> as mapped; may be out of date</span>
                </>
              ) : (
                <span className="hint">Not listed — check before you go</span>
              )}
            </dd>
            {place.phone && (
              <>
                <dt>Phone</dt>
                <dd>{place.phone}</dd>
              </>
            )}
            {place.website && (
              <>
                <dt>Website</dt>
                <dd>
                  <a
                    href={place.website}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {new URL(place.website).hostname.replace(/^www\./, "")}
                  </a>
                </dd>
              </>
            )}
            <dt>Sources</dt>
            <dd>
              <ul className="sources">
                {place.sources.map((source) => (
                  <li key={`${source.kind}-${source.url}`}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {source.label}
                    </a>{" "}
                    <span className="hint">({source.license})</span>
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
          {hasPoint ? (
            <div className="map-links">
              <span>Open in</span>
              {mapLinks({
                name: place.name,
                lat: place.lat as number,
                lon: place.lon as number,
              }).map((link) => (
                <a
                  key={link.id}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : (
            <p className="hint">
              No map position is published for this place, so there is no map
              link.
            </p>
          )}
        </details>
      </div>
    </article>
  );
}
