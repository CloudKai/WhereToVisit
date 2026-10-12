"use client";
import { useState } from "react";
import type { DayPlan, GeneratedDayPlanState, Place } from "@/shared/contracts";
export function GeneratedDayPlan({
  state,
  places,
  onEdit,
  busy = false,
}: {
  state: GeneratedDayPlanState;
  places: Place[];
  onEdit?: (
    stops: { placeId: string; desiredArrivalMinute: number | null }[],
  ) => void;
  busy?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const plan = state.plan;
  if (!plan) return null;
  const name = (id: string) => {
    const place = places.find((place) => place.id === id);
    return place
      ? `${place.displayName} · ${place.branch} · ${place.address}`
      : `Previously selected Place ${id}`;
  };
  const clock = (minute: number) =>
    `${Math.floor(minute / 60)
      .toString()
      .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
  const scheduleClock = (minute: number) =>
    minute >= 1440
      ? `${clock(minute % 1440)} (+${Math.floor(minute / 1440)} day, beyond selected day)`
      : clock(minute);
  const time = (minute: number | null) =>
    minute === null
      ? "Timing unresolved"
      : `${scheduleClock(minute)} (Shanghai, assumed schedule)`;
  const editedStops = (stops: DayPlan["stops"]) =>
    stops.map((stop) => ({
      placeId: stop.placeId,
      desiredArrivalMinute: stop.desiredArrivalMinute ?? null,
    }));
  const selectedPlace = places.find((place) => place.id === selectedId);
  return (
    <section aria-label="Generated day plan" className="import-job">
      <h3>Generated day plan</h3>
      <p>
        {plan.request.visitDate} ·{" "}
        {plan.request.mode === "walking-transit"
          ? "Walking / public transit"
          : "Taxi / car"}{" "}
        · Revision {plan.revision}
      </p>
      {plan.dataKind === "fixture" && (
        <p>
          Fictional development plan. No actual provider connectivity or venue
          verification.
        </p>
      )}
      {state.needsReview && (
        <p role="status">
          This saved plan needs review: the request or chosen Places changed.
        </p>
      )}
      <p>{plan.explanation}</p>
      {plan.manuallyEdited && (
        <p>
          Manual edits saved. Regeneration requires an explicit replacement
          choice.
        </p>
      )}
      <ol aria-label="Day stops">
        {plan.stops.map((stop, index) => (
          <li key={stop.placeId}>
            <p>{name(stop.placeId)}</p>
            <button type="button" onClick={() => setSelectedId(stop.placeId)}>
              Review branch details
            </button>
            {stop.desiredArrivalMinute !== null &&
              stop.desiredArrivalMinute !== undefined && (
                <p>
                  User-desired arrival {clock(stop.desiredArrivalMinute)}{" "}
                  (Shanghai); verify arrangements and feasibility.
                </p>
              )}
            {onEdit && (
              <>
                <button
                  type="button"
                  disabled={busy || state.needsReview || index === 0}
                  onClick={() => {
                    const stops = [...plan.stops];
                    [stops[index - 1], stops[index]] = [
                      stops[index],
                      stops[index - 1],
                    ];
                    onEdit(editedStops(stops));
                  }}
                >
                  Move earlier
                </button>
                <button
                  type="button"
                  disabled={
                    busy || state.needsReview || index === plan.stops.length - 1
                  }
                  onClick={() => {
                    const stops = [...plan.stops];
                    [stops[index], stops[index + 1]] = [
                      stops[index + 1],
                      stops[index],
                    ];
                    onEdit(editedStops(stops));
                  }}
                >
                  Move later
                </button>
                <button
                  type="button"
                  disabled={busy || state.needsReview}
                  onClick={() =>
                    onEdit(
                      editedStops(
                        plan.stops.filter(
                          (kept) => kept.placeId !== stop.placeId,
                        ),
                      ),
                    )
                  }
                >
                  Remove from this day
                </button>
                <form
                  key={`${plan.revision}:${stop.placeId}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = new FormData(event.currentTarget).get(
                      "desiredArrival",
                    ) as string;
                    const [hour, minute] = value.split(":").map(Number);
                    const stops = editedStops(plan.stops);
                    stops[index].desiredArrivalMinute = value
                      ? hour * 60 + minute
                      : null;
                    onEdit(stops);
                  }}
                >
                  <label>
                    Desired arrival (Shanghai)
                    <input
                      name="desiredArrival"
                      type="time"
                      defaultValue={
                        stop.desiredArrivalMinute === null ||
                        stop.desiredArrivalMinute === undefined
                          ? ""
                          : clock(stop.desiredArrivalMinute)
                      }
                      disabled={busy || state.needsReview}
                    />
                  </label>
                  <button type="submit" disabled={busy || state.needsReview}>
                    Save desired time
                  </button>
                </form>
              </>
            )}
            <p>
              {time(stop.arrivalMinute)} ·{" "}
              {stop.visitTimeAssumption ?? "Visit duration unknown"}
            </p>
            {stop.departureMinute !== null && (
              <p>
                Assumed departure {scheduleClock(stop.departureMinute)}{" "}
                (Shanghai)
              </p>
            )}
            <p>{stop.hoursEvidence ?? "Opening hours unknown"}</p>
          </li>
        ))}
      </ol>
      {selectedPlace && (
        <section aria-label="Day stop branch details" className="import-job">
          <h4>{name(selectedPlace.id)}</h4>
          <p>
            Canonical Place: {selectedPlace.id}. Exact map and navigation remain
            unavailable; address searches require branch confirmation.
          </p>
          <a href={`/discover?placeId=${encodeURIComponent(selectedPlace.id)}`}>
            Open this canonical Place in discovery/map context
          </a>
          <ul>
            {selectedPlace.evidence.map((evidence) => (
              <li key={evidence.id}>
                <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">
                  {evidence.attribution}
                </a>{" "}
                · checked {evidence.capturedAt.slice(0, 10)}. {evidence.limits}
              </li>
            ))}
          </ul>
          {selectedPlace.providerReferences.map((reference) =>
            reference.url && reference.qualification === "qualified" ? (
              <p key={reference.url}>
                <a href={reference.url} target="_blank" rel="noreferrer">
                  {reference.linkKind === "search"
                    ? "Search address on"
                    : "Open place on"}{" "}
                  {reference.provider}
                </a>
                . {reference.qualificationNotes} Checked{" "}
                {reference.verifiedAt.slice(0, 10)}.
              </p>
            ) : null,
          )}
          <button type="button" onClick={() => setSelectedId(null)}>
            Close branch details
          </button>
        </section>
      )}
      {plan.travelLegs.map((leg) => (
        <p key={`${leg.fromPlaceId}:${leg.toPlaceId}`}>
          Travel: {name(leg.fromPlaceId)} → {name(leg.toPlaceId)}.{" "}
          {leg.durationSeconds === null
            ? "Duration unknown"
            : `${leg.durationSeconds / 60} estimated minutes`}
          . {leg.outcome} · {leg.actualSubmode ?? "Submode unresolved"} ·{" "}
          {leg.provider ?? "No qualified provider"}. {leg.visitTimeContext} ·{" "}
          {leg.resultKind ?? "Result unresolved"} ·{" "}
          {leg.apiVersion ?? "API unqualified"} ·{" "}
          {leg.coordinateProvenance ?? "Endpoint coordinates unqualified"} ·{" "}
          {leg.retrievedAt ?? "No provider retrieval"}
        </p>
      ))}
      {plan.operatingHours.length > 0 && (
        <>
          <h4>Provider operating-hours evidence</h4>
          <ul>
            {plan.operatingHours.map((hours) => (
              <li key={hours.placeId}>
                {name(hours.placeId)} · {hours.visitDate} {hours.timeZone}:{" "}
                {hours.closed
                  ? "Closed on the selected date"
                  : `Opening interval ${clock(hours.opensMinute)}–${clock(hours.closesMinute)}`}
                . {hours.sourceExplanation} · {hours.provider}, retrieved{" "}
                {hours.retrievedAt}.
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Assumptions</h4>
      <ul>
        {plan.assumptions.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <h4>Warnings and conflicts</h4>
      <ul>
        {plan.warnings.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      {plan.unscheduledPlaces.length > 0 && (
        <>
          <h4>Unscheduled selected Places</h4>
          <ul>
            {plan.unscheduledPlaces.map((stop) => (
              <li key={stop.placeId}>
                {name(stop.placeId)}: {stop.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
