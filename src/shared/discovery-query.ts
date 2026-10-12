import type { CatalogueQuery, Place } from "./contracts";

export const budgetLabels = {
  low: "CNY 0–50",
  mid: "CNY over 50–150",
  high: "CNY over 150",
  unknown: "Price unknown",
};
/** One URL/query boundary shared by discovery and later map consumers. */
export function parseDiscoveryQuery(
  parameters: URLSearchParams,
): CatalogueQuery {
  const allowed = [
    "city",
    "category",
    "budget",
    "neighbourhood",
    "recommendationType",
    "distance",
    "latitude",
    "longitude",
    "system",
    "radiusMetres",
  ];
  for (const key of parameters.keys()) {
    if (!allowed.includes(key) || parameters.getAll(key).length !== 1)
      throw new Error("Invalid discovery query.");
  }
  const query: CatalogueQuery = { city: parameters.get("city") ?? "Shanghai" };
  if (!query.city.trim() || query.city.length > 100)
    throw new Error("Invalid city.");
  function choice(key: string, choices: string[]) {
    const value = parameters.get(key);
    if (value !== null && !choices.includes(value))
      throw new Error("Invalid filter.");
    return value ?? undefined;
  }
  query.category = choice("category", [
    "food",
    "cafe",
  ]) as CatalogueQuery["category"];
  query.budget = choice(
    "budget",
    Object.keys(budgetLabels),
  ) as CatalogueQuery["budget"];
  query.recommendationType = choice("recommendationType", [
    "trending",
    "local-favourite",
    "highly-reviewed",
    "unclassified",
  ]) as CatalogueQuery["recommendationType"];
  const neighbourhood = parameters.get("neighbourhood");
  if (neighbourhood !== null) {
    if (!neighbourhood.trim() || neighbourhood.length > 200)
      throw new Error("Invalid neighbourhood.");
    query.neighbourhood = neighbourhood;
  }
  query.unknownDistance = choice("distance", ["unknown"]) === "unknown";
  const originKeys = ["latitude", "longitude", "system", "radiusMetres"];
  if (originKeys.some((key) => parameters.has(key))) {
    if (
      query.unknownDistance ||
      !originKeys.every((key) => parameters.get(key)?.trim())
    )
      throw new Error("Choose an explicit origin and radius.");
    const latitude = Number(parameters.get("latitude"));
    const longitude = Number(parameters.get("longitude"));
    const radiusMetres = Number(parameters.get("radiusMetres"));
    const system = choice("system", ["WGS-84", "GCJ-02"]) as
      | "WGS-84"
      | "GCJ-02";
    if (
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180 ||
      !Number.isFinite(radiusMetres) ||
      radiusMetres <= 0 ||
      radiusMetres > 100000
    )
      throw new Error("Invalid origin or radius.");
    query.distance = { origin: { latitude, longitude, system }, radiusMetres };
  }
  return query;
}

export function discoveryParameters(query: CatalogueQuery): URLSearchParams {
  const parameters = new URLSearchParams({ city: query.city });
  for (const key of [
    "category",
    "budget",
    "neighbourhood",
    "recommendationType",
  ] as const) {
    if (query[key]) parameters.set(key, query[key]);
  }
  if (query.unknownDistance) parameters.set("distance", "unknown");
  if (query.distance) {
    for (const key of ["latitude", "longitude", "system"] as const)
      parameters.set(key, String(query.distance.origin[key]));
    parameters.set("radiusMetres", String(query.distance.radiusMetres));
  }
  return parameters;
}

function metresBetween(place: Place, query: CatalogueQuery): number | null {
  const coordinates = place.coordinates;
  const origin = query.distance?.origin;
  if (
    !coordinates ||
    !origin ||
    coordinates.system === "unqualified" ||
    coordinates.system !== origin.system
  )
    return null;
  const radians = Math.PI / 180;
  const latitudeDelta = (coordinates.latitude - origin.latitude) * radians;
  const longitudeDelta = (coordinates.longitude - origin.longitude) * radians;
  const square =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(origin.latitude * radians) *
      Math.cos(coordinates.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    6371000 *
    2 *
    Math.atan2(Math.sqrt(square), Math.sqrt(Math.max(0, 1 - square)))
  );
}

/** Filters intersect; missing facts never satisfy known-value constraints. */
export function matchesDiscoveryQuery(
  place: Place,
  query: CatalogueQuery,
): boolean {
  if (
    place.city !== query.city ||
    (query.category && place.category !== query.category) ||
    (query.neighbourhood && place.neighbourhood !== query.neighbourhood)
  )
    return false;
  if (query.budget === "unknown" && place.price !== null) return false;
  if (query.budget && query.budget !== "unknown") {
    if (place.price?.currency !== "CNY") return false;
    const amount = place.price.amount;
    if (query.budget === "low" && amount > 50) return false;
    if (query.budget === "mid" && (amount <= 50 || amount > 150)) return false;
    if (query.budget === "high" && amount <= 150) return false;
  }
  if (
    query.recommendationType === "unclassified" &&
    place.classifications.length
  )
    return false;
  if (
    query.recommendationType &&
    query.recommendationType !== "unclassified" &&
    !place.classifications.some(
      (item) => item.type === query.recommendationType,
    )
  )
    return false;
  if (query.unknownDistance && place.coordinates !== null) return false;
  if (query.distance) {
    const distance = metresBetween(place, query);
    if (distance === null || distance > query.distance.radiusMetres)
      return false;
  }
  return true;
}
