export type MapLink = { id: string; label: string; href: string };

type Point = { name: string; lat: number; lon: number };
type TravelMode = "walk" | "bike" | "drive";

/**
 * Turn-by-turn handoff for one leg. The app only estimates times; real
 * navigation (and public transit) happens in the user's own maps app.
 */
export function directionLinks(
  from: Point,
  to: Point,
  mode: TravelMode,
): MapLink[] {
  const a = `${from.lat},${from.lon}`;
  const b = `${to.lat},${to.lon}`;
  const google = { walk: "walking", bike: "bicycling", drive: "driving" }[mode];
  const apple = { walk: "w", bike: "w", drive: "d" }[mode];
  const amap = { walk: "walk", bike: "ride", drive: "car" }[mode];
  const place = (p: Point) => `${p.lon},${p.lat},${encodeURIComponent(p.name)}`;
  return [
    {
      id: "google",
      label: "Google Maps",
      href: `https://www.google.com/maps/dir/?api=1&origin=${a}&destination=${b}&travelmode=${google}`,
    },
    {
      id: "google-transit",
      label: "Google Maps (public transit)",
      href: `https://www.google.com/maps/dir/?api=1&origin=${a}&destination=${b}&travelmode=transit`,
    },
    {
      id: "apple",
      label: "Apple Maps",
      href: `https://maps.apple.com/?saddr=${a}&daddr=${b}&dirflg=${apple}`,
    },
    {
      id: "amap",
      label: "Amap (高德)",
      href: `https://uri.amap.com/navigation?from=${place(from)}&to=${place(to)}&mode=${amap}&coordinate=wgs84`,
    },
  ];
}

/**
 * Deep links that open the user's own maps app. They need no API key.
 * Coordinates are WGS-84; the Amap link says so explicitly because Amap
 * otherwise assumes its own offset coordinate system in mainland China.
 */
export function mapLinks(place: {
  name: string;
  lat: number;
  lon: number;
}): MapLink[] {
  const { lat, lon } = place;
  const name = encodeURIComponent(place.name);
  return [
    {
      id: "google",
      label: "Google Maps",
      href: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    },
    {
      id: "apple",
      label: "Apple Maps",
      href: `https://maps.apple.com/?ll=${lat},${lon}&q=${name}`,
    },
    {
      id: "amap",
      label: "Amap (高德)",
      href: `https://uri.amap.com/marker?position=${lon},${lat}&name=${name}&coordinate=wgs84`,
    },
    {
      id: "osm",
      label: "OpenStreetMap",
      href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
    },
  ];
}
