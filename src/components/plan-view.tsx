"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { directionLinks } from "@/lib/maplinks";
import {
  encodePlan,
  MAX_DWELL,
  MIN_DWELL,
  reorder,
  type Stop,
} from "@/lib/plan";
import {
  buildSchedule,
  estimateRoute,
  formatClock,
  formatDistance,
  formatDuration,
  MODES,
  type Mode,
  parseClock,
  type RouteResult,
} from "@/lib/routing";
import { type MapMarker, MapCanvas } from "./map";
import { usePlan } from "./plan-provider";

const MODE_LABEL: Record<Mode, string> = {
  walk: "Walk",
  bike: "Bike",
  drive: "Drive",
};
const MODE_ICON: Record<Mode, string> = { walk: "🚶", bike: "🚲", drive: "🚗" };

type RouteState = { key: string; route: RouteResult };

function routeKey(stops: Stop[], mode: Mode): string {
  return `${mode}|${stops.map((s) => s.id).join(">")}`;
}

async function requestRoute(
  stops: Stop[],
  mode: Mode,
  optimise: boolean,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const response = await fetch("/api/route", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stops: stops.map((s) => ({ lat: s.lat, lon: s.lon })),
      mode,
      optimise,
    }),
    signal,
  });
  const data = (await response.json()) as RouteResult & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Routing failed");
  return data;
}

export function PlanView() {
  const { plan, hydrated, move, remove, setDwellFor, applyOrder, clear } =
    usePlan();
  const stops = plan.stops;
  const [mode, setMode] = useState<Mode>("walk");
  const [start, setStart] = useState("10:00");
  const [state, setState] = useState<RouteState | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [link, setLink] = useState("");
  const requestId = useRef(0);

  const key = routeKey(stops, mode);
  const current = state?.key === key ? state.route : null;

  // Keep the address bar a shareable link to exactly this plan.
  useEffect(() => {
    if (!hydrated) return;
    const hash = stops.length > 0 ? `#p=${encodePlan(plan)}` : "";
    window.history.replaceState(null, "", `/plan${hash}`);
    setLink(window.location.href);
  }, [hydrated, plan, stops.length]);

  // Fetch road times whenever the order or travel mode changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures stops and mode
  useEffect(() => {
    if (!hydrated) return;
    if (stops.length < 2) {
      setBusy(false);
      return;
    }
    if (state?.key === key) {
      setBusy(false);
      return;
    }
    const id = ++requestId.current;
    const abort = new AbortController();
    setBusy(true);
    setProblem(undefined);
    const timer = setTimeout(async () => {
      try {
        const route = await requestRoute(stops, mode, false, abort.signal);
        if (id === requestId.current) setState({ key, route });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (id !== requestId.current) return;
        setProblem(
          "Couldn’t reach the routing service, so these are straight-line estimates.",
        );
        setState({
          key,
          route: estimateRoute(
            stops,
            mode,
            false,
            "Straight-line estimates (offline).",
          ),
        });
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [hydrated, key]);

  async function optimise() {
    const id = ++requestId.current;
    setBusy(true);
    setProblem(undefined);
    try {
      const route = await requestRoute(stops, mode, true);
      if (id !== requestId.current) return;
      const reordered = reorder(plan, route.order).stops;
      applyOrder(route.order);
      // The optimised route already matches the new order, so no refetch.
      setState({
        key: routeKey(reordered, mode),
        route: { ...route, order: reordered.map((_, i) => i) },
      });
    } catch (error) {
      if (id !== requestId.current) return;
      setProblem(
        error instanceof Error ? error.message : "Couldn’t optimise the order.",
      );
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  const startMin = parseClock(start) ?? 600;
  const legs = current?.legs ?? [];
  const schedule = useMemo(
    () =>
      buildSchedule(
        startMin,
        stops.map((s) => s.dwell),
        legs.map((l) => l.durationS),
      ),
    [startMin, stops, legs],
  );
  const totals = useMemo(
    () => ({
      travelS: legs.reduce((sum, l) => sum + l.durationS, 0),
      distanceM: legs.reduce((sum, l) => sum + l.distanceM, 0),
    }),
    [legs],
  );
  const markers: MapMarker[] = stops.map((s, i) => ({
    id: s.id,
    lat: s.lat,
    lon: s.lon,
    label: `${i + 1}. ${s.name}`,
    kind: "stop",
    badge: String(i + 1),
  }));

  if (!hydrated) {
    return (
      <div className="page-section" aria-busy="true">
        <p className="eyebrow" role="status">
          Loading your day…
        </p>
      </div>
    );
  }

  if (stops.length === 0) {
    return (
      <section className="page-section empty-plan">
        <p className="eyebrow">Your day</p>
        <h1>Nothing planned yet</h1>
        <p className="lead">
          Search a destination and tap “Add to my day” on the places you like.
          They’ll appear here on a map, in an order you can change, with travel
          times between them.
        </p>
        <p>
          <Link className="button" href="/">
            Find places
          </Link>
        </p>
      </section>
    );
  }

  const timesReady = stops.length < 2 || current !== null;
  const lastDepart = schedule[schedule.length - 1]?.departMin ?? startMin;
  const longWalk = mode === "walk" && legs.some((l) => l.distanceM > 5000);

  return (
    <div className="page-section plan">
      <header className="explore-head">
        <p className="eyebrow">
          Your day{plan.destination ? ` · ${plan.destination}` : ""}
        </p>
        <h1>
          {stops.length} {stops.length === 1 ? "stop" : "stops"}
        </h1>
        <p className="lead">
          Reorder the stops, set how long you’ll stay, and see how long it takes
          to get between them.
        </p>
      </header>

      <div className="plan-controls">
        <fieldset className="modes">
          <legend>Getting around</legend>
          {MODES.map((m) => (
            <label key={m} className={mode === m ? "mode active" : "mode"}>
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              <span aria-hidden="true">{MODE_ICON[m]}</span> {MODE_LABEL[m]}
            </label>
          ))}
        </fieldset>
        <label className="start">
          Start at
          <input
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={optimise}
          disabled={busy || stops.length < 3}
          title={
            stops.length < 3
              ? "Add at least 3 stops to reorder them"
              : "Keeps your first stop and finds the quickest order for the rest"
          }
        >
          {busy ? "Working…" : "Shortest route"}
        </button>
      </div>

      <div className="plan-layout">
        <div className="plan-map">
          <MapCanvas
            markers={markers}
            line={current?.geometry}
            label="Map of your day"
            selectedId={selected}
            onSelect={setSelected}
          />
        </div>

        <div className="plan-list">
          <ol className="itinerary">
            {stops.map((stop, index) => {
              const when = schedule[index];
              const leg = legs[index];
              return (
                <li key={stop.id}>
                  <article
                    className={selected === stop.id ? "stop selected" : "stop"}
                  >
                    <button
                      type="button"
                      className="stop-number"
                      onClick={() => setSelected(stop.id)}
                      aria-pressed={selected === stop.id}
                      aria-label={`Show ${stop.name} on the map`}
                    >
                      {index + 1}
                    </button>
                    <div className="stop-main">
                      <h3>{stop.name}</h3>
                      <p className="stop-time">
                        {timesReady ? (
                          <>
                            <strong>{formatClock(when.arriveMin)}</strong>
                            {" – "}
                            {formatClock(when.departMin)}
                          </>
                        ) : (
                          <span className="hint">Calculating times…</span>
                        )}
                      </p>
                      {stop.address && <p className="hint">{stop.address}</p>}
                      <p className="hint">
                        {stop.hours
                          ? `Hours as mapped: ${stop.hours} — not checked against your times`
                          : "Opening hours unknown — check before you go"}
                      </p>
                      <div className="stop-tools">
                        <label>
                          Stay
                          <input
                            type="number"
                            min={MIN_DWELL}
                            max={MAX_DWELL}
                            step={5}
                            value={stop.dwell}
                            onChange={(event) =>
                              setDwellFor(stop.id, Number(event.target.value))
                            }
                          />
                          min
                        </label>
                        <button
                          type="button"
                          onClick={() => move(stop.id, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${stop.name} earlier`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => move(stop.id, 1)}
                          disabled={index === stops.length - 1}
                          aria-label={`Move ${stop.name} later`}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => remove(stop.id)}
                          aria-label={`Remove ${stop.name}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </article>

                  {index < stops.length - 1 && (
                    <div className="leg">
                      <span aria-hidden="true">{MODE_ICON[mode]}</span>
                      {leg ? (
                        <span>
                          {formatDuration(leg.durationS)} ·{" "}
                          {formatDistance(leg.distanceM)}
                        </span>
                      ) : (
                        <span className="hint">…</span>
                      )}
                      <details className="leg-nav">
                        <summary>Directions</summary>
                        <div className="map-links">
                          {directionLinks(stop, stops[index + 1], mode).map(
                            (l) => (
                              <a
                                key={l.id}
                                href={l.href}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {l.label}
                              </a>
                            ),
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {timesReady && (
            <p className="summary">
              <strong>Done around {formatClock(lastDepart)}.</strong>{" "}
              {legs.length > 0 &&
                `${formatDuration(totals.travelS)} of ${MODE_LABEL[mode].toLowerCase()}ing · ${formatDistance(totals.distanceM)} in total.`}
            </p>
          )}
          {current && (
            <p className="hint">
              {current.source === "openrouteservice"
                ? "Travel times follow real roads and paths (OpenRouteService / OpenStreetMap)."
                : (current.note ??
                  "Travel times are straight-line estimates.")}{" "}
              They don’t include waiting, traffic or public transit — use each
              leg’s “Directions” links for live navigation.
            </p>
          )}
          {longWalk && (
            <p className="notice" role="status">
              One leg is a long walk (over 5 km). Try the bike or drive option.
            </p>
          )}
          {problem && (
            <p className="notice" role="alert">
              {problem}
            </p>
          )}

          <section className="share" aria-labelledby="share-heading">
            <h2 id="share-heading">Share this day</h2>
            <p className="hint">
              The whole plan is stored in this link — nothing is saved on a
              server. Anyone who opens it sees the same stops.
            </p>
            <div className="share-row">
              <input
                type="text"
                readOnly
                value={link}
                aria-label="Link to this plan"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="button" onClick={copyLink}>
                Copy link
              </button>
            </div>
            <p className="hint" role="status" aria-live="polite">
              {copied === "done" && "Link copied."}
              {copied === "failed" &&
                "Couldn’t copy automatically — select the link and copy it."}
            </p>
            <button type="button" className="link-button" onClick={clear}>
              Clear this plan
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
