export type MapLink = { id: string; label: string; href: string };

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
