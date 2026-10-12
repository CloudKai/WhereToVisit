"use client";
import type { GeneratedDayPlanState, Place } from "@/shared/contracts";
export function GeneratedDayPlan({
  state,
  places,
}: {
  state: GeneratedDayPlanState;
  places: Place[];
}) {
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
  const time = (minute: number | null) =>
    minute === null
      ? "Timing unresolved"
      : `${clock(minute)} (Shanghai, assumed schedule)`;
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
      <ol>
        {plan.stops.map((stop) => (
          <li key={stop.placeId}>
            <p>{name(stop.placeId)}</p>
            <p>
              {time(stop.arrivalMinute)} ·{" "}
              {stop.visitTimeAssumption ?? "Visit duration unknown"}
            </p>
            {stop.departureMinute !== null && (
              <p>Assumed departure {clock(stop.departureMinute)} (Shanghai)</p>
            )}
            <p>{stop.hoursEvidence ?? "Opening hours unknown"}</p>
          </li>
        ))}
      </ol>
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
