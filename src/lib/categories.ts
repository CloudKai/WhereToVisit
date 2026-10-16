import type { Category } from "./types.ts";

export type CategoryInfo = {
  /** Singular label shown on a card, e.g. "Park". */
  label: string;
  /** Plural label for filters and headings. */
  plural: string;
  /** One-letter code used in shareable links (keep stable!). */
  token: string;
  /** Minutes a visit usually takes; a starting point the user can change. */
  dwell: number;
  /** Geoapify place categories that map to this one. */
  geoapify: string[];
  /** How many places to request from the map data. */
  limit: number;
  /**
   * Map data holds huge numbers of tiny sights and parks (benches, statues,
   * pocket gardens). For these, only places with some sign of notability
   * (an encyclopedia entry, website or description) are kept.
   */
  notableOnly: boolean;
};

export const CATEGORY_INFO: Record<Category, CategoryInfo> = {
  cafe: {
    label: "Café",
    plural: "Cafés",
    token: "c",
    dwell: 45,
    geoapify: ["catering.cafe"],
    limit: 80,
    notableOnly: false,
  },
  food: {
    label: "Restaurant",
    plural: "Restaurants",
    token: "f",
    dwell: 75,
    geoapify: ["catering.restaurant"],
    limit: 80,
    notableOnly: false,
  },
  shopping: {
    label: "Mall / shopping",
    plural: "Malls & shopping",
    token: "s",
    dwell: 60,
    geoapify: [
      "commercial.shopping_mall",
      "commercial.department_store",
      "commercial.marketplace",
    ],
    limit: 40,
    notableOnly: false,
  },
  attraction: {
    label: "Attraction",
    plural: "Attractions",
    token: "a",
    dwell: 90,
    geoapify: [
      "tourism.sights",
      "tourism.attraction",
      "entertainment.zoo",
      "entertainment.theme_park",
    ],
    limit: 60,
    notableOnly: true,
  },
  museum: {
    label: "Museum / culture",
    plural: "Museums & culture",
    token: "m",
    dwell: 90,
    geoapify: ["entertainment.museum", "entertainment.culture"],
    limit: 40,
    notableOnly: false,
  },
  park: {
    label: "Park",
    plural: "Parks & nature",
    token: "p",
    dwell: 60,
    geoapify: ["leisure.park"],
    limit: 40,
    notableOnly: true,
  },
};

export const CATEGORIES = Object.keys(CATEGORY_INFO) as Category[];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && value in CATEGORY_INFO;
}

const BY_TOKEN = new Map<string, Category>(
  CATEGORIES.map((category) => [CATEGORY_INFO[category].token, category]),
);

export function categoryFromToken(token: unknown): Category | null {
  return typeof token === "string" ? (BY_TOKEN.get(token) ?? null) : null;
}

// ---------- filters shown on the results page ----------

export type CategoryFilter = "all" | "eat" | Category;

export const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "eat", label: "Food & drink" },
  { id: "cafe", label: "Cafés" },
  { id: "food", label: "Restaurants" },
  { id: "shopping", label: "Malls & shopping" },
  { id: "attraction", label: "Attractions" },
  { id: "museum", label: "Museums & culture" },
  { id: "park", label: "Parks & nature" },
];

export function parseCategoryFilter(
  value: string | string[] | undefined,
): CategoryFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return FILTERS.some((f) => f.id === v) ? (v as CategoryFilter) : "all";
}

export function matchesFilter(
  category: Category,
  filter: CategoryFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "eat") return category === "cafe" || category === "food";
  return category === filter;
}

/** Categories whose map data is worth fetching for a filter. */
export function categoriesForFilter(filter: CategoryFilter): Category[] {
  return CATEGORIES.filter((category) => matchesFilter(category, filter));
}
