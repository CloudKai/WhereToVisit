import {
  type CategoryFilter,
  CATEGORY_INFO,
  matchesFilter,
} from "./categories.ts";
import type { Category, Place } from "./types.ts";

/**
 * How many places "All" shows for each type. Food and drink together come to
 * 14, so a first look at a city has a real choice of places to eat.
 */
export const HEADLINE: Record<Category, number> = {
  cafe: 6,
  food: 8,
  shopping: 5,
  attraction: 8,
  museum: 5,
  park: 5,
};

/** How many places a chosen type shows before "Show more". */
export const FILTERED_VISIBLE = 15;

/** Fewer food and drink places than this makes a city search widen itself. */
export const MIN_FOOD_PLACES = 10;

/** Keeps the first `max` places of each type, preserving order. */
export function capPerType(places: Place[], max: number): Place[] {
  const seen = new Map<string, number>();
  return places.filter((place) => {
    const count = seen.get(place.category) ?? 0;
    seen.set(place.category, count + 1);
    return count < max;
  });
}

export type Lists = { editorPicks: Place[]; nearby: Place[] };

export type Visible = {
  picks: Place[];
  more: Place[];
  /** Matching places not shown yet. */
  hidden: number;
};

/**
 * Chooses what to show. Editor picks always come before other places, and the
 * original (best first) order is kept. With `expanded`, everything is shown.
 */
export function selectVisible(
  lists: Lists,
  filter: CategoryFilter,
  expanded: boolean,
): Visible {
  const picks = lists.editorPicks.filter((p) =>
    matchesFilter(p.category, filter),
  );
  const more = lists.nearby.filter((p) => matchesFilter(p.category, filter));
  const total = picks.length + more.length;
  if (expanded) return { picks, more, hidden: 0 };

  const used = new Map<Category, number>();
  let shown = 0;
  const take = (place: Place): boolean => {
    if (filter === "all") {
      const count = used.get(place.category) ?? 0;
      if (count >= HEADLINE[place.category]) return false;
      used.set(place.category, count + 1);
      return true;
    }
    if (shown >= FILTERED_VISIBLE) return false;
    shown++;
    return true;
  };
  const visiblePicks = picks.filter(take);
  const visibleMore = more.filter(take);
  return {
    picks: visiblePicks,
    more: visibleMore,
    hidden: total - visiblePicks.length - visibleMore.length,
  };
}

/** How many places a filter chip stands for (before any limit). */
export function countFor(lists: Lists, filter: CategoryFilter): number {
  return [...lists.editorPicks, ...lists.nearby].filter((p) =>
    matchesFilter(p.category, filter),
  ).length;
}

/** Food and drink places (cafés and restaurants) in a set of places. */
export function foodCount(places: Pick<Place, "category">[]): number {
  return places.filter((p) => p.category === "cafe" || p.category === "food")
    .length;
}

/** For tests and docs: the total "All" shows when every type is full. */
export function headlineTotal(): number {
  return (Object.keys(CATEGORY_INFO) as Category[]).reduce(
    (sum, category) => sum + HEADLINE[category],
    0,
  );
}
