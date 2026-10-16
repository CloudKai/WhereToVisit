"use client";
import { useState } from "react";
import { type MapMarker, MapCanvas } from "./map";

/** Map of the places on the page; clicking a pin jumps to its card. */
export function PlacesMap({ markers }: { markers: MapMarker[] }) {
  const [selected, setSelected] = useState<string>();

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

  return (
    <div className="places-map">
      <MapCanvas
        markers={markers}
        label="Map of recommended places"
        selectedId={selected}
        onSelect={select}
      />
      <p className="legend" aria-hidden="true">
        <span className="legend-dot legend-editor" /> Editor pick
        <span className="legend-dot legend-nearby" /> Nearby
      </p>
    </div>
  );
}
