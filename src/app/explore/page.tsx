import type { Metadata } from "next";
import Link from "next/link";
import { PlaceCard } from "@/components/place-card";
import { PlacesMap } from "@/components/places-map";
import type { MapMarker } from "@/components/map";
import { SearchBox } from "@/components/search-box";
import { ConfigError } from "@/lib/config";
import {
  type CategoryFilter,
  exploreHref,
  parseDestination,
  parseFilter,
} from "@/lib/destination";
import { explore } from "@/lib/explore";
import type { Place } from "@/lib/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const destination = parseDestination(await searchParams);
  return {
    title: destination
      ? `Where to eat in ${destination.name} — WhereToVisit`
      : "Explore — WhereToVisit",
  };
}

const FILTERS: [CategoryFilter, string][] = [
  ["all", "All"],
  ["cafe", "Cafés"],
  ["food", "Restaurants"],
];

function applyFilter(places: Place[], filter: CategoryFilter): Place[] {
  return filter === "all"
    ? places
    : places.filter((p) => p.category === filter);
}

function Problem({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="page-section problem" role="alert">
      <h1>{title}</h1>
      {children}
    </section>
  );
}

export default async function Explore({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const destination = parseDestination(params);
  const filter = parseFilter(params.type);

  if (!destination) {
    return (
      <section className="page-section">
        <h1>Choose a destination</h1>
        <p>That link is missing a valid destination. Search for one below.</p>
        <SearchBox autoFocus />
      </section>
    );
  }

  let result: Awaited<ReturnType<typeof explore>>;
  try {
    result = await explore(destination);
  } catch (error) {
    if (error instanceof ConfigError) {
      return (
        <Problem title="Setup needed">
          <p>
            This app needs the <code>{error.missing}</code> setting. Add it to{" "}
            <code>.env.local</code> and restart the server (see the README).
          </p>
        </Problem>
      );
    }
    console.warn(
      `[explore] failed: ${error instanceof Error ? error.message : "error"}`,
    );
    return (
      <Problem title="We couldn’t load places right now">
        <p>
          The data services didn’t respond. This is usually temporary.{" "}
          <Link href={exploreHref(destination, filter)}>Try again</Link> or{" "}
          <Link href="/">search another destination</Link>.
        </p>
      </Problem>
    );
  }

  const picks = applyFilter(result.editorPicks, filter);
  const nearby = applyFilter(result.nearby, filter);
  const markers: MapMarker[] = [...picks, ...nearby]
    .filter((p) => p.lat !== undefined && p.lon !== undefined)
    .map((p) => ({
      id: p.id,
      lat: p.lat as number,
      lon: p.lon as number,
      label: p.name,
      kind: p.tier,
    }));
  const place = destination.country
    ? `${destination.name}, ${destination.country}`
    : destination.name;

  return (
    <div className="page-section">
      <header className="explore-head">
        <p className="eyebrow">Eat &amp; drink in</p>
        <h1>{place}</h1>
        <p className="lead">
          {result.editorPicks.length > 0
            ? `${result.editorPicks.length} places recommended by travel editors, plus ${result.nearby.length} more nearby.`
            : `${result.nearby.length} places found nearby.`}
        </p>
        <nav className="filters" aria-label="Filter by type">
          {FILTERS.map(([value, label]) => (
            <Link
              key={value}
              href={exploreHref(destination, value)}
              aria-current={filter === value ? "true" : undefined}
              className={filter === value ? "chip active" : "chip"}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {result.notes.map((note) => (
        <p key={note} className="notice" role="status">
          {note}
        </p>
      ))}

      {markers.length > 0 && <PlacesMap markers={markers} />}

      {picks.length > 0 && (
        <section aria-labelledby="picks-heading">
          <h2 id="picks-heading">Recommended by travel editors</h2>
          <p className="section-note">
            Written by Wikivoyage contributors. Each card links to its source.
            {result.aiUsed &&
              " Some long notes are condensed by AI using only the source text; the full note is always one click away."}
          </p>
          <div className="grid">
            {picks.map((p) => (
              <PlaceCard key={p.id} place={p} destination={destination.name} />
            ))}
          </div>
        </section>
      )}

      {nearby.length > 0 && (
        <section aria-labelledby="nearby-heading" className="nearby">
          <details open={picks.length === 0}>
            <summary id="nearby-heading">
              {picks.length > 0
                ? `More places nearby (${nearby.length})`
                : `Places nearby (${nearby.length})`}
            </summary>
            <p className="section-note">
              From OpenStreetMap. These have no editor recommendation, so they
              are ordered by how complete their information is — not by quality.
            </p>
            <div className="grid">
              {nearby.map((p) => (
                <PlaceCard
                  key={p.id}
                  place={p}
                  destination={destination.name}
                />
              ))}
            </div>
          </details>
        </section>
      )}

      {picks.length === 0 && nearby.length === 0 && (
        <section className="empty" role="status">
          <h2>Nothing found for this filter</h2>
          <p>
            Try <Link href={exploreHref(destination, "all")}>all types</Link>,
            or search a nearby larger area.
          </p>
        </section>
      )}
    </div>
  );
}
