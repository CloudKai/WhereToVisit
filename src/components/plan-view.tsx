"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { directionLinks, googleDayLink } from "@/lib/maplinks";
import {
  encodePlan,
  MAX_DWELL,
  MAX_STOPS_PER_DAY,
  MIN_DWELL,
  reorderDay,
  type Stop,
  stopCount,
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
import { MapCanvas, type MapMarker } from "./map";
import { usePlan } from "./plan-provider";
import { ShareRoom } from "./share-room";

const MODE_LABEL: Record<Mode, string> = {
  walk: "Walk",
  bike: "Bike",
  drive: "Drive",
};
const MODE_ICON: Record<Mode, string> = { walk: "🚶", bike: "🚲", drive: "🚗" };

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
  const {
    plan,
    hydrated,
    activeDay,
    setActiveDay,
    move,
    remove,
    moveToDay,
    setDwellFor,
    applyOrder,
    setStart,
    setMode,
    addNewDay,
    removeDayAt,
    canAddDay,
    clear,
  } = usePlan();
  const day = plan.days[activeDay];
  const stops = day.stops;
  const mode = day.mode;
  const [routes, setRoutes] = useState<Record<string, RouteResult>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [link, setLink] = useState("");
  const requestId = useRef(0);

  const key = routeKey(stops, mode);
  const current = routes[key] ?? null;
  const total = stopCount(plan);

  // Keep the address bar a shareable link to exactly this trip.
  useEffect(() => {
    if (!hydrated) return;
    const hash = total > 0 ? `#p=${encodePlan(plan)}` : "";
    window.history.replaceState(null, "", `/plan${hash}`);
    setLink(window.location.href);
  }, [hydrated, plan, total]);

  // Fetch road times for the day being viewed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures the day's stops and mode
  useEffect(() => {
    if (!hydrated) return;
    if (stops.length < 2 || routes[key]) {
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
        if (id === requestId.current)
          setRoutes((r) => ({ ...r, [key]: route }));
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (id !== requestId.current) return;
        setProblem(
          "Couldn’t reach the routing service, so these are straight-line estimates.",
        );
        setRoutes((r) => ({
          ...r,
          [key]: estimateRoute(
            stops,
            mode,
            false,
            "Straight-line estimates (offline).",
          ),
        }));
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
      const reordered = reorderDay(plan, activeDay, route.order).days[activeDay]
        .stops;
      applyOrder(activeDay, route.order);
      // The optimised route already matches the new order, so no refetch.
      setRoutes((r) => ({
        ...r,
        [routeKey(reordered, mode)]: {
          ...route,
          order: reordered.map((_, i) => i),
        },
      }));
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

  const legs = current?.legs ?? [];
  const schedule = useMemo(
    () =>
      buildSchedule(
        day.start,
        stops.map((s) => s.dwell),
        legs.map((l) => l.durationS),
      ),
    [day.start, stops, legs],
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
          Loading your trip…
        </p>
      </div>
    );
  }

  if (total === 0 && plan.days.length === 1) {
    return (
      <section className="page-section empty-plan">
        <p className="eyebrow">Your trip</p>
        <h1>Nothing planned yet</h1>
        <p className="lead">
          Search a destination and tap “Add to my trip” on the places you like.
          Build one day or several: each day gets its own map, route and travel
          times.
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
  const lastDepart = schedule[schedule.length - 1]?.departMin ?? day.start;
  const longWalk = mode === "walk" && legs.some((l) => l.distanceM > 5000);
  const dayLink = googleDayLink(stops, mode);

  return (
    <div className="page-section plan">
      <header className="explore-head">
        <p className="eyebrow">
          Your trip{plan.destination ? ` · ${plan.destination}` : ""}
        </p>
        <h1>
          {plan.days.length} {plan.days.length === 1 ? "day" : "days"} · {total}{" "}
          {total === 1 ? "stop" : "stops"}
        </h1>
        <p className="lead">
          Each day has its own map, route and travel times. Reorder stops, set
          how long you’ll stay, or move a place to another day.
        </p>
      </header>

      <nav className="day-tabs" aria-label="Days">
        {plan.days.map((d, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: days have no identity beyond their position
            key={i}
            type="button"
            className={i === activeDay ? "day-tab active" : "day-tab"}
            aria-current={i === activeDay ? "true" : undefined}
            onClick={() => {
              setActiveDay(i);
              setSelected(undefined);
            }}
          >
            Day {i + 1}
            <span className="day-count">{d.stops.length}</span>
          </button>
        ))}
        <button
          type="button"
          className="day-tab add-day"
          onClick={addNewDay}
          disabled={!canAddDay}
          title={canAddDay ? "Add another day" : "Trips can have up to 10 days"}
        >
          + Add day
        </button>
      </nav>

      <div className="plan-controls">
        <fieldset className="modes">
          <legend>Getting around on day {activeDay + 1}</legend>
          {MODES.map((m) => (
            <label key={m} className={mode === m ? "mode active" : "mode"}>
              <input
                type="radio"
                name={`mode-${activeDay}`}
                value={m}
                checked={mode === m}
                onChange={() => setMode(activeDay, m)}
              />
              <span aria-hidden="true">{MODE_ICON[m]}</span> {MODE_LABEL[m]}
            </label>
          ))}
        </fieldset>
        <label className="start">
          Start at
          <input
            type="time"
            value={formatClock(day.start)}
            onChange={(event) => {
              const minutes = parseClock(event.target.value);
              if (minutes !== null) setStart(activeDay, minutes);
            }}
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

      {stops.length === 0 ? (
        <section className="empty-day">
          <h2>Day {activeDay + 1} is empty</h2>
          <p className="lead">
            Find places and tap “Add to Day {activeDay + 1}”, or move stops here
            from another day.
          </p>
          <p>
            <Link className="button" href="/">
              Find places
            </Link>{" "}
            {plan.days.length > 1 && (
              <button
                type="button"
                className="link-button"
                onClick={() => removeDayAt(activeDay)}
              >
                Remove this day
              </button>
            )}
          </p>
        </section>
      ) : (
        <div className="plan-layout">
          <div className="plan-map">
            <MapCanvas
              markers={markers}
              line={current?.geometry}
              label={`Map of day ${activeDay + 1}`}
              selectedId={selected}
              onSelect={setSelected}
            />
          </div>

          <div className="plan-list">
            <ol className="itinerary">
              {stops.map((stop, index) => {
                const when = schedule[index];
                const leg = legs[index];
                const steps = current?.steps?.[index] ?? [];
                return (
                  <li key={stop.id}>
                    <article
                      className={
                        selected === stop.id ? "stop selected" : "stop"
                      }
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
                          {plan.days.length > 1 && (
                            <select
                              aria-label={`Move ${stop.name} to another day`}
                              value=""
                              onChange={(event) => {
                                const to = Number(event.target.value);
                                if (Number.isInteger(to))
                                  moveToDay(stop.id, to);
                              }}
                            >
                              <option value="">Move to…</option>
                              {plan.days.map((d, i) =>
                                i === activeDay ? null : (
                                  <option
                                    // biome-ignore lint/suspicious/noArrayIndexKey: days are positional
                                    key={i}
                                    value={i}
                                    disabled={
                                      d.stops.length >= MAX_STOPS_PER_DAY
                                    }
                                  >
                                    Day {i + 1}
                                    {d.stops.length >= MAX_STOPS_PER_DAY
                                      ? " (full)"
                                      : ""}
                                  </option>
                                ),
                              )}
                            </select>
                          )}
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
                          {steps.length > 0 && (
                            <ol
                              className="steps-list"
                              aria-label="Step-by-step directions"
                            >
                              {steps.map((step, i) => (
                                <li
                                  // biome-ignore lint/suspicious/noArrayIndexKey: steps are an ordered, static list
                                  key={i}
                                >
                                  {step.text}
                                  {step.distanceM > 0 && (
                                    <span className="hint">
                                      {" "}
                                      · {formatDistance(step.distanceM)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ol>
                          )}
                          <div className="map-links">
                            <span>Open in</span>
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
                <strong>
                  Day {activeDay + 1} ends around {formatClock(lastDepart)}.
                </strong>{" "}
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
            {dayLink ? (
              <p>
                <a
                  className="button secondary"
                  href={dayLink}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open this whole day in Google Maps
                </a>
              </p>
            ) : (
              stops.length > 11 && (
                <p className="hint">
                  Google Maps can’t take more than 11 stops in one link; use the
                  per-leg links instead.
                </p>
              )
            )}
            {longWalk && (
              <p className="notice" role="status">
                One leg is a long walk (over 5 km). Try the bike or drive
                option.
              </p>
            )}
            {problem && (
              <p className="notice" role="alert">
                {problem}
              </p>
            )}
            {plan.days.length > 1 && (
              <p>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove Day ${activeDay + 1} and its ${stops.length} stops?`,
                      )
                    ) {
                      removeDayAt(activeDay);
                    }
                  }}
                >
                  Remove day {activeDay + 1}
                </button>
              </p>
            )}
          </div>
        </div>
      )}

      <div className="plan-footer">
        <ShareRoom />

        <section className="share" aria-labelledby="share-heading">
          <h2 id="share-heading">Share this trip</h2>
          <p className="hint">
            The whole trip — every day — is stored in this link. Nothing is
            saved on a server. Anyone who opens it sees the same plan.
          </p>
          <div className="share-row">
            <input
              type="text"
              readOnly
              value={link}
              aria-label="Link to this trip"
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
          <button
            type="button"
            className="link-button"
            onClick={() => {
              if (window.confirm("Clear the whole trip?")) clear();
            }}
          >
            Clear this trip
          </button>
        </section>
      </div>
    </div>
  );
}
