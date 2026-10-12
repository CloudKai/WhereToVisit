"use client";
import type { MapArea, Place } from "@/shared/contracts";
import { coordinatesWithinArea, sameMapArea } from "@/shared/discovery-query";

export const initialFixtureArea: MapArea = {
  south: 31.2,
  north: 31.26,
  west: 121.36,
  east: 121.5,
  system: "WGS-84",
};
export function areaDescription(area: MapArea) {
  return `south ${area.south.toFixed(4)}, north ${area.north.toFixed(4)}, west ${area.west.toFixed(4)}, east ${area.east.toFixed(4)} (${area.system})`;
}
export function DiscoveryMap({
  places,
  selectedId,
  onSelect,
  pendingArea,
  searchedArea,
  moved,
  onMove,
  onSearch,
  loading,
  onFailure,
}: {
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  pendingArea: MapArea;
  searchedArea: MapArea | null;
  moved: boolean;
  onMove: (area: MapArea) => void;
  onSearch: () => void;
  loading: boolean;
  onFailure: () => void;
}) {
  function pan(latitude: number, longitude: number) {
    onMove({
      ...pendingArea,
      north: pendingArea.north + latitude,
      south: pendingArea.south + latitude,
      east: pendingArea.east + longitude,
      west: pendingArea.west + longitude,
    });
  }
  function zoom(factor: number) {
    const latitude = (pendingArea.north + pendingArea.south) / 2;
    const longitude = (pendingArea.east + pendingArea.west) / 2;
    const halfHeight = ((pendingArea.north - pendingArea.south) * factor) / 2;
    const halfWidth = ((pendingArea.east - pendingArea.west) * factor) / 2;
    if (
      halfHeight < 0.0001 ||
      halfHeight > 5 ||
      halfWidth < 0.0001 ||
      halfWidth > 5
    )
      return;
    onMove({
      north: latitude + halfHeight,
      south: latitude - halfHeight,
      east: longitude + halfWidth,
      west: longitude - halfWidth,
      system: pendingArea.system,
    });
  }
  const visible = places.filter((place) =>
    coordinatesWithinArea(place.coordinates, pendingArea),
  );
  return (
    <>
      <p className="fixture-notice">
        Fictional map — development behavior only
      </p>
      <p>
        Coordinate diagram with fictional places, not a street map or provider
        verification. Pan and zoom controls work with a keyboard. List selection
        provides the same place details.
      </p>
      <fieldset className="actions map-controls" aria-label="Map movement">
        <button
          className="secondary-button"
          type="button"
          onClick={() => pan(0.04, 0)}
        >
          Pan north
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => pan(-0.04, 0)}
        >
          Pan south
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => pan(0, 0.04)}
        >
          Pan east
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => pan(0, -0.04)}
        >
          Pan west
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => zoom(0.5)}
        >
          Zoom in
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => zoom(2)}
        >
          Zoom out
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => onMove(initialFixtureArea)}
        >
          Return to initial area
        </button>
      </fieldset>
      <fieldset
        className="fixture-map"
        aria-label="Fictional coordinate diagram"
      >
        {visible.map((place, index) => (
          <button
            className="map-place"
            key={place.id}
            type="button"
            aria-label={`Map place: ${place.displayName}, ${place.branch ?? place.id}`}
            aria-pressed={selectedId === place.id}
            onClick={() => onSelect(place.id)}
            style={{
              left: `${5 + (90 * ((place.coordinates?.longitude ?? 0) - pendingArea.west)) / (pendingArea.east - pendingArea.west)}%`,
              top: `${5 + (90 * (pendingArea.north - (place.coordinates?.latitude ?? 0))) / (pendingArea.north - pendingArea.south)}%`,
            }}
          >
            {index + 1}
          </button>
        ))}
      </fieldset>
      <p>Pending map area: {areaDescription(pendingArea)}.</p>
      <p>
        {loading
          ? "Area/list refresh in progress; previous pins are hidden."
          : `${visible.length} result places are visible in the pending viewport. Moving the map does not refresh the list.`}
      </p>
      <button
        className="button"
        type="button"
        disabled={
          !moved || (!loading && sameMapArea(pendingArea, searchedArea))
        }
        onClick={onSearch}
      >
        Search this area
      </button>
      <p>
        Search intersects the bounded Shanghai discovery envelope, not an
        administrative boundary or exhaustive venue coverage. Missing or
        incompatible coordinates are excluded.
      </p>
      <button className="secondary-button" type="button" onClick={onFailure}>
        Simulate map failure
      </button>
    </>
  );
}
