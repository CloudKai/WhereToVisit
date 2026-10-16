"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { exploreHref } from "@/lib/destination";
import type { Suggestion } from "@/lib/types";

type Status = "idle" | "loading" | "ready" | "empty" | "error" | "setup";

const STATUS_TEXT: Partial<Record<Status, string>> = {
  loading: "Searching…",
  empty: "No matching destinations. Try a city or neighbourhood name.",
  error:
    "Search is unavailable right now. Pick one of the popular cities below.",
  setup:
    "Search needs a Geoapify key in .env.local. Pick a popular city below.",
};

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const text = query.trim();
    controller.current?.abort();
    if (text.length < 2) {
      setItems([]);
      setStatus("idle");
      return;
    }
    const timer = setTimeout(async () => {
      const abort = new AbortController();
      controller.current = abort;
      setStatus("loading");
      try {
        const response = await fetch(
          `/api/suggest?q=${encodeURIComponent(text)}`,
          {
            signal: abort.signal,
          },
        );
        const data = (await response.json()) as {
          suggestions?: Suggestion[];
          error?: string;
        };
        if (data.error === "not-configured") return setStatus("setup");
        if (!response.ok) return setStatus("error");
        const found = data.suggestions ?? [];
        setItems(found);
        setActive(-1);
        setOpen(found.length > 0);
        setStatus(found.length > 0 ? "ready" : "empty");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setStatus("error");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function choose(suggestion: Suggestion) {
    setOpen(false);
    setQuery(suggestion.label);
    router.push(exploreHref(suggestion));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp" && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const pick = items[active >= 0 ? active : 0];
    if (pick) choose(pick);
  }

  const optionId = (index: number) => `${listId}-option-${index}`;
  const message = STATUS_TEXT[status];

  return (
    <form
      className="search"
      role="search"
      onSubmit={onSubmit}
      autoComplete="off"
    >
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        Where are you going?
      </label>
      <div className="search-field">
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="11"
            cy="11"
            r="6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="m16 16 4.5 4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder="Where are you going? Try Kyoto, Lisbon, Shibuya…"
          value={query}
          maxLength={80}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => items.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          // biome-ignore lint/a11y/noAutofocus: the home page's single purpose is this field
          autoFocus={autoFocus}
        />
        <button type="submit" className="button" disabled={items.length === 0}>
          Find places
        </button>
      </div>
      <ul id={listId} role="listbox" className="suggestions" hidden={!open}>
        {items.map((item, index) => (
          <li
            key={item.label}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={index === active ? "active" : undefined}
            onMouseDown={(event) => {
              event.preventDefault();
              choose(item);
            }}
            onMouseEnter={() => setActive(index)}
          >
            <span className="suggestion-name">{item.name}</span>
            <span className="suggestion-detail">{item.label}</span>
          </li>
        ))}
      </ul>
      <p className="search-status" role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
