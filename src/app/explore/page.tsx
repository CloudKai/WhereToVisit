import type { Metadata } from "next";
import Link from "next/link";
import { PlaceCard } from "@/components/place-card";
import { PlacesMap } from "@/components/places-map";
import type { MapMarker } from "@/components/map";
import { SearchBox } from "@/components/search-box";
import { ConfigError } from "@/lib/config";
import { failureReason } from "@/lib/http";
import { type CategoryFilter, FILTERS, matchesFilter } from "@/lib/categories";
import {
  AREA_OPTIONS,
  exploreHref,
  nearestArea,
  parseDestination,
  parseFilter,
} from "@/lib/destination";
import { capPerType, explore, HEADLINE_PER_TYPE } from "@/lib/explore";
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
      ? `Things to do and eat in ${destination.name} — WhereToVisit`
      : "Explore — WhereToVisit",
  };
}

/** "All" shows the top few of each type; choosing a type shows everything. */
function applyFilter(places: Place[], filter: CategoryFilter): Place[] {
  const matching = places.filter((p) => matchesFilter(p.category, filter));
  return filter === "all" ? capPerType(matching, HEADLINE_PER_TYPE) : matching;
}

function countFor(
  result: { editorPicks: Place[]; nearby: Place[] },
  filter: CategoryFilter,
) {
  return [...result.editorPicks, ...result.nearby].filter((p) =>
    matchesFilter(p.category, filter),
  ).length;
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
    const reason = failureReason(error);
    if (reason === "key-rejected" || reason === "quota") {
      return (
        <Problem
          title={
            reason === "key-rejected"
              ? "The place-data key was rejected"
              : "Today’s place-data limit has been reached"
          }
        >
          <p>
            {reason === "key-rejected" ? (
              <>
                Geoapify refused the key in <code>GEOAPIFY_API_KEY</code>. Check
                that it is copied exactly (no quotes or spaces) and restart the
                server. In development, open <code>/api/status</code> to test
                it.
              </>
            ) : (
              <>The free daily allowance is used up. Try again tomorrow.</>
            )}
          </p>
        </Problem>
      );
    }
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
        <p className="eyebrow">
          {destination.bounds
            ? "Places in the map area you chose · near"
            : "Places to eat, shop and see in"}
        </p>
        <h1>{place}</h1>
        <p className="lead">
          {result.editorPicks.length > 0
            ? `${result.editorPicks.length} places recommended by travel editors, plus ${result.nearby.length} more nearby.`
            : `${result.nearby.length} places found nearby.`}
          {filter === "all" &&
            ` Showing the top ${HEADLINE_PER_TYPE} of each type — choose a type to see more.`}
        </p>
        <nav className="filters" aria-label="Filter by type">
          {FILTERS.map(({ id, label }) => (
            <Link
              key={id}
              href={exploreHref(destination, id)}
              aria-current={filter === id ? "true" : undefined}
              className={filter === id ? "chip active" : "chip"}
            >
              {label}
              <span className="chip-count">{countFor(result, id)}</span>
            </Link>
          ))}
        </nav>
        {destination.bounds ? (
          <p className="area-banner hint">
            Showing only places inside the area you chose on the map. Move the
            map and press “Search this area” to look somewhere else, or{" "}
            <Link href="/">start a new search</Link>.
          </p>
        ) : (
          <nav className="filters" aria-label="Search area">
            <span className="filter-label">Search area</span>
            {AREA_OPTIONS.map((option) => {
              const active =
                nearestArea(destination.radiusM).radiusM === option.radiusM;
              return (
                <Link
                  key={option.radiusM}
                  href={exploreHref(
                    { ...destination, radiusM: option.radiusM },
                    filter,
                  )}
                  aria-current={active ? "true" : undefined}
                  className={active ? "chip active" : "chip"}
                >
                  {option.label} · {option.detail}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {result.notes.map((note) => (
        <p key={note} className="notice" role="status">
          {note}
        </p>
      ))}

      {(markers.length > 0 || destination.bounds) && (
        <PlacesMap
          markers={markers}
          place={{ name: destination.name, country: destination.country }}
          filter={filter}
          viewBounds={destination.bounds}
        />
      )}

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
