"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { CategoryFilter } from "@/lib/categories";
import { exploreHref } from "@/lib/destination";
import { areaProblem, circleCovering, MAX_AREA_SIDE_KM } from "@/lib/geo";
import type { Bounds } from "@/lib/types";
import { MapCanvas, type MapMarker } from "./map";

type Props = {
  markers: MapMarker[];
  /** The place being explored; its name is kept when searching a map area. */
  place: { name: string; country?: string };
  filter: CategoryFilter;
  /** Set when the page is already showing a searched map area. */
  viewBounds?: Bounds;
};

/**
 * Map of the places on the page. Clicking a pin jumps to its card. After the
 * map is moved, "Search this area" rebuilds the list for what is on screen.
 */
export function PlacesMap({ markers, place, filter, viewBounds }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>();
  const [moved, setMoved] = useState<Bounds | null>(null);
  const [pending, startTransition] = useTransition();

  // New results arrived: the map is showing them, so there is nothing to re-search.
  const resultKey = `${markers.map((m) => m.id).join(",")}|${viewBounds ? JSON.stringify(viewBounds) : ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: resultKey changes exactly when new results arrive
  useEffect(() => {
    setMoved(null);
  }, [resultKey]);

  function select(id: string) {
    setSelected(id);
    const card = document.getElementById(`place-${id}`);
    if (!card) return;
    // Cards under "More places nearby" start collapsed.
    card.closest("details")?.setAttribute("open", "");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({
      behavior: calm ? "auto" : "smooth",
      block: "center",
    });
    card.focus({ preventScroll: true });
    card.classList.add("card-flash");
    setTimeout(() => card.classList.remove("card-flash"), 1800);
  }

  function searchHere() {
    if (!moved || areaProblem(moved)) return;
    const circle = circleCovering(moved);
    startTransition(() => {
      router.push(exploreHref({ ...place, ...circle, bounds: moved }, filter), {
        scroll: false,
      });
    });
  }

  const problem = moved ? areaProblem(moved) : null;

  return (
    <div className="places-map">
      <div className="map-wrap">
        <MapCanvas
          markers={markers}
          label="Map of places"
          selectedId={selected}
          onSelect={select}
          viewBounds={viewBounds}
          onUserMove={setMoved}
        />
        {(moved || pending) && (
          <div className="map-overlay">
            <button
              type="button"
              className="search-area-button"
              onClick={searchHere}
              disabled={pending || problem !== null}
              aria-busy={pending}
            >
              {pending
                ? "Searching this area…"
                : problem === "too-large"
                  ? "Zoom in to search this area"
                  : problem === "too-small"
                    ? "Zoom out a little to search"
                    : "Search this area"}
            </button>
          </div>
        )}
      </div>
      {problem === "too-large" && (
        <p className="hint" role="status">
          Areas up to about {MAX_AREA_SIDE_KM} km across can be searched.
        </p>
      )}
      <p className="legend" aria-hidden="true">
        <span className="legend-dot legend-editor" /> Editor pick
        <span className="legend-dot legend-nearby" /> Nearby
      </p>
    </div>
  );
}
