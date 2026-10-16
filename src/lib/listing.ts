import { type CategoryFilter, matchesFilter } from "./categories.ts";
import type { Place } from "./types.ts";

/** "All" shows this many places of each type; choosing a type shows everything. */
export const HEADLINE_PER_TYPE = 5;

/** Keeps the first `max` places of each type, preserving order. */
export function capPerType(places: Place[], max: number): Place[] {
  const seen = new Map<string, number>();
  return places.filter((place) => {
    const count = seen.get(place.category) ?? 0;
    seen.set(place.category, count + 1);
    return count < max;
  });
}

/** The places to show for a filter. */
export function applyFilter(places: Place[], filter: CategoryFilter): Place[] {
  const matching = places.filter((p) => matchesFilter(p.category, filter));
  return filter === "all" ? capPerType(matching, HEADLINE_PER_TYPE) : matching;
}

/** How many places a filter chip stands for (before the "All" cap). */
export function countFor(
  lists: { editorPicks: Place[]; nearby: Place[] },
  filter: CategoryFilter,
): number {
  return [...lists.editorPicks, ...lists.nearby].filter((p) =>
    matchesFilter(p.category, filter),
  ).length;
}
