"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { exploreHref } from "@/lib/destination";
import type { Suggestion } from "@/lib/types";

type Status =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "rate-limited"
  | "key-rejected"
  | "quota"
  | "unavailable"
  | "not-configured"
  | "backup-pick";

const BACKUP_HINT = " Press Enter to try the backup search.";

const STATUS_TEXT: Partial<Record<Status, string>> = {
  loading: "Searching…",
  empty: "No matching place found. Try a city name, like “Lisbon” or “Kyoto”.",
  "rate-limited": "You’re searching very quickly. Wait a moment and try again.",
  "key-rejected": `The place-search key was rejected — the site owner should check GEOAPIFY_API_KEY.${BACKUP_HINT}`,
  quota: `Today’s place-search limit has been reached.${BACKUP_HINT}`,
  unavailable: `Live suggestions are unavailable right now.${BACKUP_HINT}`,
  "not-configured": `Live suggestions need a Geoapify key in .env.local.${BACKUP_HINT}`,
  "backup-pick": "Choose the right match:",
};

type Outcome = { suggestions: Suggestion[]; status: Status };

async function lookup(
  text: string,
  submitted: boolean,
  signal?: AbortSignal,
): Promise<Outcome> {
  const params = new URLSearchParams({ q: text });
  if (submitted) params.set("submit", "1");
  const response = await fetch(`/api/suggest?${params}`, { signal });
  let data: { suggestions?: Suggestion[]; error?: string } = {};
  try {
    data = await response.json();
  } catch {
    // fall through to a generic failure
  }
  const suggestions = data.suggestions ?? [];
  if (response.ok) {
    return { suggestions, status: suggestions.length > 0 ? "ready" : "empty" };
  }
  const known: Status[] = [
    "rate-limited",
    "key-rejected",
    "quota",
    "not-configured",
  ];
  const status = known.find((s) => s === data.error) ?? "unavailable";
  return { suggestions: [], status };
}

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [submitting, setSubmitting] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // Suggestions while typing (debounced).
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
        const outcome = await lookup(text, false, abort.signal);
        setItems(outcome.suggestions);
        setActive(-1);
        setOpen(outcome.suggestions.length > 0);
        setStatus(outcome.status);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setStatus("unavailable");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function choose(suggestion: Suggestion) {
    setOpen(false);
    setQuery(suggestion.label);
    router.push(exploreHref(suggestion));
  }

  // Pressing Enter: use what is on screen, or run a full search.
  async function submitSearch() {
    const text = query.trim();
    if (text.length < 2) return;
    controller.current?.abort();
    setSubmitting(true);
    setStatus("loading");
    try {
      const outcome = await lookup(text, true);
      if (outcome.suggestions.length === 1) {
        choose(outcome.suggestions[0]);
        return;
      }
      setItems(outcome.suggestions);
      setActive(-1);
      setOpen(outcome.suggestions.length > 0);
      setStatus(
        outcome.suggestions.length > 0 ? "backup-pick" : outcome.status,
      );
    } catch {
      setStatus("unavailable");
    } finally {
      setSubmitting(false);
    }
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
    const pick = active >= 0 ? items[active] : undefined;
    if (pick) choose(pick);
    else if (status === "ready" && items[0]) choose(items[0]);
    else void submitSearch();
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
          placeholder="Any city or neighbourhood: Shanghai, Kyoto, Shibuya…"
          value={query}
          maxLength={80}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => items.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          // biome-ignore lint/a11y/noAutofocus: the home page's single purpose is this field
          autoFocus={autoFocus}
        />
        <button
          type="submit"
          className="button"
          disabled={query.trim().length < 2 || submitting}
        >
          {submitting ? "Searching…" : "Find places"}
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
