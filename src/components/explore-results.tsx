"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { type CategoryFilter, FILTERS } from "@/lib/categories";
import { AREA_OPTIONS, exploreHref, nearestArea } from "@/lib/destination";
import { countFor, FILTERED_VISIBLE, selectVisible } from "@/lib/listing";
import type { Destination, Place } from "@/lib/types";
import type { MapMarker } from "./map";
import { PlaceCard } from "./place-card";
import { PlacesMap } from "./places-map";

type Props = {
  destination: Destination;
  editorPicks: Place[];
  nearby: Place[];
  notes: string[];
  aiUsed: boolean;
  initialFilter: CategoryFilter;
};

/**
 * The whole results view. Every place for the area is delivered once, so
 * choosing a type just filters what is already here: no new request, no wait.
 */
export function ExploreResults({
  destination,
  editorPicks,
  nearby,
  notes,
  aiUsed,
  initialFilter,
}: Props) {
  const [filter, setFilter] = useState<CategoryFilter>(initialFilter);
  const [expanded, setExpanded] = useState(false);

  const lists = useMemo(() => ({ editorPicks, nearby }), [editorPicks, nearby]);
  const { picks, more, hidden } = useMemo(
    () => selectVisible(lists, filter, expanded),
    [lists, filter, expanded],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, countFor(lists, f.id)]),
      ) as Record<CategoryFilter, number>,
    [lists],
  );
  const markers: MapMarker[] = useMemo(
    () =>
      [...picks, ...more]
        .filter((p) => p.lat !== undefined && p.lon !== undefined)
        .map((p) => ({
          id: p.id,
          lat: p.lat as number,
          lon: p.lon as number,
          label: p.name,
          kind: p.tier,
        })),
    [picks, more],
  );

  function choose(next: CategoryFilter) {
    setFilter(next);
    setExpanded(false);
    // Keep the address bar shareable without asking the server for anything.
    window.history.replaceState(null, "", exploreHref(destination, next));
  }

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
          {editorPicks.length > 0
            ? `${editorPicks.length} places recommended by travel editors, plus ${nearby.length} more nearby.`
            : `${nearby.length} places found nearby.`}
          {hidden > 0 &&
            (filter === "all"
              ? " Showing the best of each type — choose a type to see more."
              : ` Showing the top ${FILTERED_VISIBLE}.`)}
        </p>
        <nav className="filters" aria-label="Filter by type">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              className={filter === id ? "chip active" : "chip"}
              onClick={() => choose(id)}
            >
              {label}
              <span className="chip-count">{counts[id]}</span>
            </button>
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

      {notes.map((note) => (
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
            {aiUsed &&
              " Some long notes are condensed by AI using only the source text; the full note is always one click away."}
          </p>
          <div className="grid">
            {picks.map((p) => (
              <PlaceCard key={p.id} place={p} destination={destination.name} />
            ))}
          </div>
        </section>
      )}

      {more.length > 0 && (
        <section aria-labelledby="nearby-heading" className="nearby">
          <h2 id="nearby-heading">
            {picks.length > 0 ? "More places nearby" : "Places nearby"}
          </h2>
          <p className="section-note">
            From OpenStreetMap. These have no editor recommendation, so they are
            ordered by how complete their information is — not by quality.
          </p>
          <div className="grid">
            {more.map((p) => (
              <PlaceCard key={p.id} place={p} destination={destination.name} />
            ))}
          </div>
        </section>
      )}

      {hidden > 0 && (
        <p className="show-more">
          <button
            type="button"
            className="button secondary"
            onClick={() => setExpanded(true)}
          >
            Show {hidden} more
          </button>
        </p>
      )}

      {picks.length === 0 && more.length === 0 && (
        <section className="empty" role="status">
          <h2>Nothing found for this filter</h2>
          <p>
            Try{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => choose("all")}
            >
              all types
            </button>
            {destination.bounds
              ? ", or move the map and search another area."
              : ", or search a nearby larger area."}
          </p>
        </section>
      )}
    </div>
  );
}
