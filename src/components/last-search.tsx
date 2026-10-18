"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { type LastSearch, parseLastSearch } from "@/lib/last-search";

const STORAGE_KEY = "wtv.last.search";

type Context = {
  last: LastSearch | null;
  remember: (search: LastSearch) => void;
};

const SearchContext = createContext<Context | null>(null);

/** Remembers the place last searched, for the header tab, within this browser tab. */
export function LastSearchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [last, setLast] = useState<LastSearch | null>(null);

  useEffect(() => {
    try {
      setLast(parseLastSearch(window.sessionStorage.getItem(STORAGE_KEY)));
    } catch {
      // storage unavailable: the tab just won't survive a reload
    }
  }, []);

  const remember = useCallback((search: LastSearch) => {
    setLast((current) =>
      current?.name === search.name && current.href === search.href
        ? current
        : search,
    );
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(search));
    } catch {
      // not fatal
    }
  }, []);

  const value = useMemo(() => ({ last, remember }), [last, remember]);
  return (
    <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
  );
}

export function useLastSearch(): Context {
  const value = useContext(SearchContext);
  if (!value)
    throw new Error("useLastSearch must be used inside <LastSearchProvider>");
  return value;
}

/**
 * The first header tab. It reads "Search" until a place has been searched,
 * then it shows that place and leads back to its results. Only the logo goes
 * back to the search box.
 */
export function SearchNavLink() {
  const { last } = useLastSearch();
  const pathname = usePathname();
  if (!last) {
    return (
      <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
        Search
      </Link>
    );
  }
  return (
    <Link
      href={last.href}
      className="place-tab"
      title={`Back to results for ${last.name}`}
      aria-current={pathname === "/explore" ? "page" : undefined}
    >
      <span aria-hidden="true">📍</span>
      <span className="place-tab-name">{last.name}</span>
    </Link>
  );
}
