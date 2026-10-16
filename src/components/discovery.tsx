"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CatalogueQuery,
  CatalogueResult,
  MapArea,
  OperationResult,
} from "@/shared/contracts";
import {
  budgetLabels,
  discoveryParameters,
  parseDiscoveryQuery,
  sameMapArea,
} from "@/shared/discovery-query";
import { CatalogueList } from "./catalogue-list";
import {
  areaDescription,
  DiscoveryMap,
  initialFixtureArea,
} from "./discovery-map";
import { OperationState } from "./operation-state";

type Result = OperationResult<CatalogueResult>;
function catalogueNeighbourhoods(places: CatalogueResult["places"]) {
  return [
    ...new Set(
      places
        .map((place) => place.neighbourhood)
        .filter((item): item is string => item !== null),
    ),
  ];
}
function shortlist(places: CatalogueResult["places"], limit: number) {
  const counts = { food: 0, cafe: 0 };
  return places.filter((place) => ++counts[place.category] <= limit);
}
export function Discovery({
  initialResult,
  mapFixtureEnabled = false,
  initialPlaceId,
}: {
  initialResult: Result;
  mapFixtureEnabled?: boolean;
  initialPlaceId?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialResult.status === "available" &&
      initialResult.data.places.some((place) => place.id === initialPlaceId)
      ? (initialPlaceId ?? null)
      : null,
  );
  const [selectionRevision, setSelectionRevision] = useState(
    initialPlaceId ? 1 : 0,
  );
  const [limit, setLimit] = useState(10);
  const [dirty, setDirty] = useState(false);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  function clearSelection() {
    setSuggestionId(null);
    if (suggestionId) setSelectedId(null);
  }
  const [view, setView] = useState("both");
  const [pendingArea, setPendingArea] = useState<MapArea>(initialFixtureArea);
  const [searchedArea, setSearchedArea] = useState<MapArea | null>(null);
  const [moved, setMoved] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  function select(id: string) {
    setSuggestionId(null);
    setSelectedId(id);
    setSelectionRevision((revision) => revision + 1);
    setView("both");
  }
  const [result, setResult] = useState(initialResult);
  const fixtureMap =
    mapFixtureEnabled &&
    result.status === "available" &&
    result.data.dataKind === "fixture";
  const [loading, setLoading] = useState(false);
  const [distanceMode, setDistanceMode] = useState("any");
  const [applied, setApplied] = useState<CatalogueQuery>({ city: "Shanghai" });
  const form = useRef<HTMLFormElement>(null);
  const filters = useRef<HTMLDetailsElement>(null);
  const requestVersion = useRef(0);
  const list = useRef<HTMLElement>(null);
  const revealResults = useRef(false);
  useEffect(() => {
    if (!loading && revealResults.current) {
      list.current?.scrollIntoView({ block: "start" });
      revealResults.current = false;
    }
  }, [loading]);
  const [neighbourhoods, setNeighbourhoods] = useState(() =>
    initialResult.status === "available"
      ? catalogueNeighbourhoods(initialResult.data.places)
      : [],
  );
  const availablePlaces =
    result.status === "available" ? result.data.places : [];
  const displayedPlaces = shortlist(availablePlaces, limit);
  const pendingViewport =
    fixtureMap && moved && !sameMapArea(pendingArea, searchedArea);
  const canSurprise =
    !loading &&
    !dirty &&
    !pendingViewport &&
    result.status === "available" &&
    displayedPlaces.length > 0;
  const suggestion = displayedPlaces.find((place) => place.id === suggestionId);
  async function load(query: CatalogueQuery, reveal = false) {
    clearSelection();
    setDirty(false);
    revealResults.current = reveal;
    const version = ++requestVersion.current;
    setLoading(true);
    setApplied(query);
    try {
      const response = await fetch(
        `/api/catalogue?${discoveryParameters(query)}`,
        { cache: "no-store" },
      );
      const next: Result = await response.json();
      if (!["available", "unavailable", "error"].includes(next.status))
        throw new Error("Invalid response");
      if (version !== requestVersion.current) return;
      setResult(next);
      if (next.status === "available") {
        setSearchedArea(next.data.areaSearch?.requestedArea ?? null);
        setSelectedId((previous) =>
          shortlist(next.data.places, limit).some(
            (place) => place.id === previous,
          )
            ? previous
            : null,
        );
      }
      if (next.status === "available")
        setNeighbourhoods((previous) => [
          ...new Set([
            ...previous,
            ...catalogueNeighbourhoods(next.data.places),
          ]),
        ]);
    } catch {
      if (version !== requestVersion.current) return;
      setResult({
        status: "error",
        reason: "catalogue-request-failed",
        message: "The shortlist could not be loaded. Please try again.",
        retryable: true,
      });
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  function reset() {
    form.current?.reset();
    setLimit(10);
    setDistanceMode("any");
    setPendingArea(initialFixtureArea);
    setMoved(false);
    setSearchedArea(null);
    void load({ city: "Shanghai" }, true);
  }
  return (
    <>
      <div className="discovery-summary">
        <p>
          <strong>{applied.city}</strong> ·{" "}
          {applied.category === "cafe"
            ? "Cafés"
            : applied.category === "food"
              ? "Food"
              : "Food & cafés"}
          {applied.budget
            ? ` · ${budgetLabels[applied.budget]}`
            : " · Any price"}
          {applied.neighbourhood ? ` · ${applied.neighbourhood}` : ""}
          {applied.recommendationType ? ` · ${applied.recommendationType}` : ""}
          {applied.distance ? " · Distance filter" : ""}
          {applied.unknownDistance ? " · Coordinates unknown" : ""}
          {applied.area ? " · Searched area" : ""}
        </p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            if (filters.current) {
              filters.current.open = true;
              filters.current.querySelector("summary")?.focus();
              filters.current.scrollIntoView({ block: "start" });
            }
          }}
        >
          Change filters
        </button>
      </div>
      <div className="shortlist-controls">
        <label>
          Places per category
          <select
            disabled={loading}
            value={limit}
            onChange={(event) => {
              const nextLimit = Number(event.target.value);
              setLimit(nextLimit);
              clearSelection();
              if (
                !shortlist(availablePlaces, nextLimit).some(
                  (place) => place.id === selectedId,
                )
              )
                setSelectedId(null);
            }}
          >
            {[1, 3, 5, 10].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          type="button"
          disabled={!canSurprise}
          onClick={() => {
            if (!canSurprise) return;
            const place =
              displayedPlaces[
                Math.floor(Math.random() * displayedPlaces.length)
              ];
            select(place.id);
            setSuggestionId(place.id);
          }}
        >
          Surprise me
        </button>
        <span className="shortlist-count">
          {loading
            ? "Loading matching places…"
            : `Reviewed order · ${displayedPlaces.length} shown / ${availablePlaces.length} available`}
        </span>
      </div>
      <p className="shortlist-status" role="status">
        {suggestion
          ? `Suggestion: ${suggestion.displayName}, ${suggestion.branch ?? suggestion.id}. Inspect the highlighted branch; nothing saved. Repeats are possible.`
          : dirty
            ? "Apply filters to use Surprise me with your changes."
            : loading
              ? "Wait for the current places to load."
              : pendingViewport
                ? "Search this area to use Surprise me in the pending viewport."
                : result.status !== "available"
                  ? "Retry the catalogue before choosing a suggestion."
                  : displayedPlaces.length === 0
                    ? "No candidates. Try fewer filters or reset."
                    : null}
      </p>
      <section
        aria-label="Discovery list"
        ref={list}
        hidden={view === "map" && fixtureMap && !mapFailed}
        aria-busy={loading}
      >
        {loading ? (
          <OperationState
            kind="loading"
            title="Loading places"
            message="Checking the current shortlist…"
          />
        ) : (
          <>
            {applied.distance && (
              <p>
                Distance origin: {applied.distance.origin.latitude},{" "}
                {applied.distance.origin.longitude} (
                {applied.distance.origin.system}); radius{" "}
                {applied.distance.radiusMetres} metres. Straight-line distance,
                not a route.
              </p>
            )}
            {result.status === "available" ? (
              <>
                {result.data.places.length === 0 && (
                  <OperationState
                    kind="unavailable"
                    title="No matching places"
                    message="Try fewer filters or reset. Unknown price, coordinates and recommendation types cannot meet known-value filters."
                  />
                )}
                <CatalogueList
                  catalogue={{ ...result.data, places: displayedPlaces }}
                  selectedId={selectedId}
                  selectionRevision={selectionRevision}
                  onSelect={select}
                />
              </>
            ) : (
              <OperationState
                kind={result.status}
                title={
                  result.status === "error"
                    ? "Places could not be loaded"
                    : "Catalogue unavailable"
                }
                message={result.message}
              >
                {!(
                  result.status === "error" && result.reason === "invalid-query"
                ) && (
                  <button
                    className="button"
                    type="button"
                    onClick={() => void load(applied, true)}
                  >
                    Retry catalogue
                  </button>
                )}
              </OperationState>
            )}
          </>
        )}
      </section>
      <details className="filter-disclosure" ref={filters}>
        <summary>Filters and search options</summary>
        <form
          ref={form}
          className="discovery-filters"
          onChange={() => {
            setDirty(true);
            clearSelection();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (loading) return;
            const parameters = new URLSearchParams();
            for (const [key, value] of new FormData(event.currentTarget))
              if (typeof value === "string" && value)
                parameters.set(key, value);
            try {
              void load(
                {
                  ...parseDiscoveryQuery(parameters),
                  ...(applied.area ? { area: applied.area } : {}),
                },
                true,
              );
            } catch {
              list.current?.scrollIntoView({ block: "start" });
              ++requestVersion.current;
              setLoading(false);
              setResult({
                status: "error",
                reason: "invalid-query",
                message:
                  "Choose a valid city and filters. Distance needs latitude, longitude, coordinate system and a radius up to 100 km.",
                retryable: false,
              });
            }
          }}
        >
          <fieldset>
            <legend>Choose your places</legend>
            <div className="filter-grid">
              <label>
                City
                <input
                  name="city"
                  defaultValue="Shanghai"
                  list="supported-cities"
                  required
                  maxLength={100}
                />
              </label>
              <datalist id="supported-cities">
                <option value="Shanghai" />
              </datalist>
              <label>
                Category
                <select name="category" aria-label="Category">
                  <option value="">Food and cafés</option>
                  <option value="food">Food</option>
                  <option value="cafe">Cafés</option>
                </select>
              </label>
              <label>
                Budget
                <select name="budget" aria-label="Budget">
                  <option value="">Any price, including unknown</option>
                  {Object.entries(budgetLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Neighbourhood
                <select name="neighbourhood" aria-label="Neighbourhood">
                  <option value="">All covered neighbourhoods</option>
                  {neighbourhoods.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Recommendation type
                <select
                  name="recommendationType"
                  aria-label="Recommendation type"
                >
                  <option value="">All, including unclassified</option>
                  <option value="trending">Trending</option>
                  <option value="local-favourite">Local favourite</option>
                  <option value="highly-reviewed">Highly reviewed</option>
                  <option value="unclassified">Unclassified</option>
                </select>
              </label>
              <label>
                Distance
                <select
                  aria-label="Distance"
                  value={distanceMode}
                  onChange={(event) => setDistanceMode(event.target.value)}
                >
                  <option value="any">Any distance, including unknown</option>
                  <option value="within">
                    Within a radius of my chosen point
                  </option>
                  <option value="unknown">Coordinates unknown</option>
                </select>
              </label>
            </div>
            {distanceMode === "unknown" && (
              <input type="hidden" name="distance" value="unknown" />
            )}
            {distanceMode === "within" && (
              <div className="filter-grid origin-fields">
                <label>
                  Origin latitude
                  <input
                    name="latitude"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    required
                  />
                </label>
                <label>
                  Origin longitude
                  <input
                    name="longitude"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    required
                  />
                </label>
                <label>
                  Coordinate system
                  <select name="system" aria-label="Coordinate system">
                    <option value="WGS-84">WGS-84</option>
                    <option value="GCJ-02">GCJ-02</option>
                  </select>
                </label>
                <label>
                  Radius (metres)
                  <input
                    name="radiusMetres"
                    type="number"
                    min={1}
                    max={100000}
                    defaultValue={1000}
                    required
                  />
                </label>
              </div>
            )}
            <p className="filter-note">
              Reviewed order keeps up to {limit} places per category after
              filters, with fewer where coverage is small. This is not a
              popularity or rating ranking. Surprise me picks one displayed
              candidate; repeats are possible.
            </p>
            <p className="filter-note">
              Known price bands use sourced CNY amounts. Unknown prices do not
              meet a price band. Recommendation types require source evidence.
            </p>
            <p className="filter-note">
              Distance is straight-line from your entered point, using the same
              coordinate system. Places without compatible coordinates are
              excluded. Device location is never requested.
            </p>
            <div className="actions">
              <button className="button" type="submit" disabled={loading}>
                {loading ? "Applying filters…" : "Apply filters"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={reset}
              >
                Reset filters
              </button>
            </div>
          </fieldset>
        </form>
      </details>
      <fieldset className="actions view-controls" aria-label="Discovery views">
        <button
          className="secondary-button"
          type="button"
          aria-pressed={view === "map"}
          onClick={() => setView("map")}
        >
          Show map
        </button>
        <button
          className="secondary-button"
          type="button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          Show list
        </button>
        <button
          className="secondary-button"
          type="button"
          aria-pressed={view === "both"}
          onClick={() => setView("both")}
        >
          Show both views
        </button>
      </fieldset>
      <section aria-label="Discovery map" hidden={view === "list"}>
        {fixtureMap && !mapFailed ? (
          <DiscoveryMap
            places={
              !loading && result.status === "available" ? displayedPlaces : []
            }
            selectedId={selectedId}
            onSelect={select}
            pendingArea={pendingArea}
            searchedArea={searchedArea}
            moved={moved}
            onMove={(area) => {
              clearSelection();
              setPendingArea(area);
              setMoved(true);
            }}
            onSearch={() => void load({ ...applied, area: pendingArea })}
            loading={loading}
            onFailure={() => {
              setMapFailed(true);
              setView("both");
            }}
          />
        ) : (
          <OperationState
            kind="unavailable"
            title="Map unavailable"
            message={
              mapFailed
                ? "The development map failed. Your current place list and details remain available."
                : "Live Shanghai map rendering and branch coordinates are not qualified yet. Browse the source-backed list and external address searches; no exact pins are shown."
            }
          >
            {mapFailed && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setMapFailed(false)}
              >
                Retry development map
              </button>
            )}
            <button
              className="secondary-button"
              type="button"
              onClick={() => setView("list")}
            >
              Browse place list
            </button>
          </OperationState>
        )}
      </section>
      {searchedArea && (
        <p>
          Last completed area search: {areaDescription(searchedArea)}. This is
          the completed requested viewport; the coverage message identifies the
          actual searched intersection.
        </p>
      )}
    </>
  );
}
