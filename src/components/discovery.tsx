"use client";
import { useRef, useState } from "react";
import type {
  CatalogueQuery,
  CatalogueResult,
  OperationResult,
} from "@/shared/contracts";
import {
  budgetLabels,
  discoveryParameters,
  parseDiscoveryQuery,
} from "@/shared/discovery-query";
import { CatalogueList } from "./catalogue-list";
import { OperationState } from "./operation-state";

type Result = OperationResult<CatalogueResult>;
export function Discovery({ initialResult }: { initialResult: Result }) {
  const [result, setResult] = useState(initialResult);
  const [loading, setLoading] = useState(false);
  const [distanceMode, setDistanceMode] = useState("any");
  const [applied, setApplied] = useState<CatalogueQuery>({ city: "Shanghai" });
  const form = useRef<HTMLFormElement>(null);
  const requestVersion = useRef(0);
  const [neighbourhoods, setNeighbourhoods] = useState(() =>
    initialResult.status === "available"
      ? [
          ...new Set(
            initialResult.data.places
              .map((place) => place.neighbourhood)
              .filter((item): item is string => item !== null),
          ),
        ]
      : [],
  );
  async function load(query: CatalogueQuery) {
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
      if (next.status === "available")
        setNeighbourhoods((previous) => [
          ...new Set([
            ...previous,
            ...next.data.places
              .map((place) => place.neighbourhood)
              .filter((item): item is string => item !== null),
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
    setDistanceMode("any");
    void load({ city: "Shanghai" });
  }
  return (
    <>
      <form
        ref={form}
        className="discovery-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const parameters = new URLSearchParams();
          for (const [key, value] of new FormData(event.currentTarget))
            if (typeof value === "string" && value) parameters.set(key, value);
          try {
            void load(parseDiscoveryQuery(parameters));
          } catch {
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
            Known price bands use sourced CNY amounts. Unknown prices do not
            meet a price band. Recommendation types require source evidence.
          </p>
          <p className="filter-note">
            Distance is straight-line from your entered point, using the same
            coordinate system. Places without compatible coordinates are
            excluded. Device location is never requested.
          </p>
          <div className="actions">
            <button className="button" type="submit">
              Apply filters
            </button>
            <button className="secondary-button" type="button" onClick={reset}>
              Reset filters
            </button>
          </div>
        </fieldset>
      </form>
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
              <CatalogueList catalogue={result.data} />
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
                  onClick={() => void load(applied)}
                >
                  Retry catalogue
                </button>
              )}
            </OperationState>
          )}
        </>
      )}
    </>
  );
}
