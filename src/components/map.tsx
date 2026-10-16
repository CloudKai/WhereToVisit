"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

/** Free vector tiles from OpenFreeMap (OpenStreetMap data). No key needed. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export type MapMarker = {
  id: string;
  lat: number;
  lon: number;
  label: string;
  kind: "editor" | "nearby" | "stop";
  /** Short text shown inside the pin, such as the stop number. */
  badge?: string;
};

type MapLibre = typeof import("maplibre-gl");

type Props = {
  markers: MapMarker[];
  /** Route geometry as [lon, lat] pairs. */
  line?: [number, number][];
  label: string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
};

function markerKey(markers: MapMarker[]): string {
  return markers
    .map((m) => `${m.id}|${m.lat}|${m.lon}|${m.kind}|${m.badge ?? ""}`)
    .join(";");
}

function lineKey(line: [number, number][] | undefined): string {
  if (!line || line.length === 0) return "";
  return `${line.length}:${line.reduce((sum, c) => sum + c[0] * 31 + c[1] * 17, 0)}`;
}

export function MapCanvas({
  markers,
  line,
  label,
  selectedId,
  onSelect,
  className,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ map: MapLibreMap; lib: MapLibre } | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const latest = useRef({ markers, line, onSelect });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latest.current = { markers, line, onSelect };
  });

  // Create the map once, in the browser only.
  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    let map: MapLibreMap | undefined;
    // A single failed tile is normal; a map that never finishes loading is not.
    const giveUp = setTimeout(() => {
      if (!loaded && !cancelled) {
        map?.remove();
        map = undefined;
        setFailed(true);
      }
    }, 15000);
    (async () => {
      try {
        const mod = await import("maplibre-gl");
        const lib = (mod.default ?? mod) as MapLibre;
        if (cancelled || !container.current) return;
        map = new lib.Map({
          container: container.current,
          style: STYLE_URL,
          center: [0, 20],
          zoom: 1.5,
          attributionControl: { compact: true },
        });
        map.addControl(
          new lib.NavigationControl({ showCompass: false }),
          "top-right",
        );
        map.on("load", () => {
          loaded = true;
          clearTimeout(giveUp);
          if (map && !cancelled) {
            ctx.current = { map, lib };
            setReady(true);
          }
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(giveUp);
      ctx.current = null;
      map?.remove();
    };
  }, []);

  const mKey = markerKey(markers);
  const lKey = lineKey(line);

  // Draw pins and the route whenever they change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mKey/lKey summarise markers/line; latest holds the values
  useEffect(() => {
    const current = ctx.current;
    if (!ready || !current) return;
    const { map, lib } = current;
    const { markers: pins, line: path } = latest.current;

    const created: Marker[] = [];
    elements.current.clear();
    for (const pin of pins) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `pin pin-${pin.kind}`;
      el.title = pin.label;
      el.setAttribute("aria-label", pin.label);
      if (pin.badge) el.textContent = pin.badge;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        latest.current.onSelect?.(pin.id);
      });
      created.push(
        new lib.Marker({ element: el })
          .setLngLat([pin.lon, pin.lat])
          .addTo(map),
      );
      elements.current.set(pin.id, el);
    }

    const data: Parameters<GeoJSONSource["setData"]>[0] =
      path && path.length > 1
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: path },
          }
        : { type: "FeatureCollection", features: [] };
    const source = map.getSource("route") as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource("route", { type: "geojson", data });
      const layout = { "line-join": "round", "line-cap": "round" } as const;
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout,
        paint: {
          "line-color": "#ffffff",
          "line-width": 8,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout,
        paint: { "line-color": "#c4492a", "line-width": 4.5 },
      });
    }

    if (pins.length === 1) {
      map.jumpTo({ center: [pins[0].lon, pins[0].lat], zoom: 15 });
    } else if (pins.length > 1) {
      const bounds = new lib.LngLatBounds();
      for (const pin of pins) bounds.extend([pin.lon, pin.lat]);
      for (const point of path ?? []) bounds.extend(point);
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
    }

    return () => {
      for (const marker of created) marker.remove();
    };
  }, [ready, mKey, lKey]);

  // Highlight the selected pin.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run after pins are rebuilt
  useEffect(() => {
    for (const [id, el] of elements.current) {
      el.classList.toggle("pin-selected", id === selectedId);
    }
  }, [selectedId, ready, mKey]);

  if (failed) {
    return (
      <div className={`map map-failed ${className ?? ""}`} role="note">
        <p>
          The map couldn’t load. It may be blocked on this network, or your
          browser may not support WebGL. Everything else on this page still
          works.
        </p>
      </div>
    );
  }
  return (
    <div
      ref={container}
      className={`map ${className ?? ""}`}
      role="region"
      aria-label={label}
    />
  );
}
