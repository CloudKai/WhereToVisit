import { CATEGORY_INFO } from "@/lib/categories";
import { mapLinks } from "@/lib/maplinks";
import { placeToStop } from "@/lib/plan";
import type { Place } from "@/lib/types";
import { AddToPlanButton } from "./add-to-plan";
import { SocialBadges, SocialPanel } from "./social-panel";

function hueFor(text: string): number {
  let hash = 0;
  for (const char of text)
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  return hash;
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Simple line icon per type, shown when there is no photo. */
function CategoryGlyph({ category }: { category: Place["category"] }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="glyph">
      {category === "cafe" && (
        <>
          <path
            d="M10 18h24v10a10 10 0 0 1-10 10h-4A10 10 0 0 1 10 28V18Z"
            {...STROKE}
          />
          <path d="M34 21h3a4 4 0 0 1 0 8h-4" {...STROKE} />
          <path d="M17 8c-2 3 2 4 0 7M24 8c-2 3 2 4 0 7" {...STROKE} />
        </>
      )}
      {category === "food" && (
        <>
          <path d="M6 24h36a18 18 0 0 1-36 0Z" {...STROKE} />
          <path
            d="M16 14c-2 3 2 4 0 7M24 11c-2 3 2 4 0 7M32 14c-2 3 2 4 0 7"
            {...STROKE}
          />
        </>
      )}
      {category === "shopping" && (
        <>
          <path d="M9 16h30l-2.5 24h-25L9 16Z" {...STROKE} />
          <path d="M17 22v-5a7 7 0 0 1 14 0v5" {...STROKE} />
        </>
      )}
      {category === "attraction" && (
        <>
          <path
            d="M24 5l5.5 11.3 12.5 1.8-9 8.8 2.1 12.4L24 33.4l-11.1 5.9L15 26.9 6 18.1l12.5-1.8L24 5Z"
            {...STROKE}
          />
        </>
      )}
      {category === "museum" && (
        <>
          <path d="M6 18 24 7l18 11H6Z" {...STROKE} />
          <path d="M11 22v14M19 22v14M29 22v14M37 22v14M7 40h34" {...STROKE} />
        </>
      )}
      {category === "park" && (
        <>
          <path
            d="M24 5c8 6 12 13 12 19a12 12 0 0 1-24 0c0-6 4-13 12-19Z"
            {...STROKE}
          />
          <path d="M24 36v8M24 24v12" {...STROKE} />
        </>
      )}
    </svg>
  );
}

function Media({ place }: { place: Place }) {
  const hue = hueFor(place.name);
  const label = CATEGORY_INFO[place.category].label;
  const nearby = place.photo?.kind === "nearby";
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
          alt={
            nearby
              ? `Photo taken near ${place.name} (Wikimedia Commons)`
              : `${place.name} (photo from Wikimedia Commons)`
          }
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
          {nearby ? "Photo taken nearby" : "Photo"}: {place.photo.credit}
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

export function PlaceCard({
  place,
  destination,
}: {
  place: Place;
  destination?: string;
}) {
  const hasPoint = place.lat !== undefined && place.lon !== undefined;
  return (
    <article className="card" id={`place-${place.id}`} tabIndex={-1}>
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
        <SocialBadges place={place} />
        <Reason place={place} />
        <AddToPlanButton stop={placeToStop(place)} destination={destination} />
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
        <SocialPanel place={place} city={destination ?? ""} />
      </div>
    </article>
  );
}
