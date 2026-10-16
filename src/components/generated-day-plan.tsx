"use client";
import { useEffect, useRef, useState } from "react";
import type {
  DayPlan,
  GeneratedDayPlanState,
  Place,
  SavedVisitFacts,
} from "@/shared/contracts";

import { VisitFacts } from "./visit-facts";

const arrivalValue = (minute: number | null | undefined) =>
  minute === null || minute === undefined
    ? ""
    : `${Math.floor(minute / 60)
        .toString()
        .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;

export function GeneratedDayPlan({
  state,
  places,
  visitFacts = {},
  onEdit,
  onRestore,
  busy = false,
  onDirtyChange,
  selectedPlaceIds,
}: {
  state: GeneratedDayPlanState;
  places: Place[];
  visitFacts?: Record<string, SavedVisitFacts | undefined>;
  selectedPlaceIds?: string[];
  onEdit?: (
    stops: { placeId: string; desiredArrivalMinute: number | null }[],
  ) => void;
  onRestore?: (placeId: string) => void;
  busy?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const plan = state.plan;
  const [arrivalEdits, setArrivalEdits] = useState<Record<string, string>>({});
  const previousPlan = useRef(plan);
  const [retainedArrivals, setRetainedArrivals] = useState<
    {
      key: string;
      placeId: string;
      name: string;
      value: string;
      visitDate: string;
      planId: string;
      revision: number;
    }[]
  >([]);
  useEffect(() => {
    const previous = previousPlan.current;
    if (previous === plan) return;
    const replaced =
      previous &&
      plan &&
      (previous.id !== plan.id ||
        previous.dataKind !== plan.dataKind ||
        previous.request.visitDate !== plan.request.visitDate ||
        (!plan.manuallyEdited && plan.revision !== previous.revision));
    const incompatible = Object.entries(arrivalEdits).filter(([id, value]) => {
      const before = previous?.stops.find((stop) => stop.placeId === id);
      return (
        previous &&
        value !== arrivalValue(before?.desiredArrivalMinute) &&
        (replaced || !plan?.stops.some((stop) => stop.placeId === id))
      );
    });
    if (previous && incompatible.length) {
      setRetainedArrivals((current) => [
        ...current,
        ...incompatible
          .map(([placeId, value]) => ({
            key: `${previous.id}:${previous.revision}:${placeId}`,
            placeId,
            name:
              places.find((place) => place.id === placeId)?.displayName ??
              "Previously included stop",
            value,
            visitDate: previous.request.visitDate,
            planId: previous.id,
            revision: previous.revision,
          }))
          .filter((draft) => !current.some((kept) => kept.key === draft.key)),
      ]);
    }
    setArrivalEdits(
      Object.fromEntries(
        Object.entries(arrivalEdits).filter(([id, value]) => {
          const before = previous?.stops.find((stop) => stop.placeId === id);
          const after = plan?.stops.find((stop) => stop.placeId === id);
          return (
            !replaced &&
            after &&
            value !== arrivalValue(before?.desiredArrivalMinute) &&
            value !== arrivalValue(after.desiredArrivalMinute)
          );
        }),
      ),
    );
    previousPlan.current = plan;
  }, [plan, arrivalEdits, places]);
  const [copyNotice, setCopyNotice] = useState("");
  const directionsAllowed = (id: string) =>
    !visitFacts[id]?.identityReviewRequired &&
    (!visitFacts[id] || visitFacts[id]?.fields.address.outcome === "checked");
  async function copyAddress(place: Place) {
    try {
      await navigator.clipboard.writeText(
        [place.localName ?? place.displayName, place.address]
          .filter(Boolean)
          .join("\n"),
      );
      setCopyNotice(`Address copied for ${place.displayName}.`);
    } catch {
      setCopyNotice(
        "Could not copy automatically. Select and copy the local name and address shown above.",
      );
    }
  }
  const dirty =
    retainedArrivals.length > 0 ||
    (plan?.stops.some(
      (stop) =>
        arrivalEdits[stop.placeId] !== undefined &&
        arrivalEdits[stop.placeId] !== arrivalValue(stop.desiredArrivalMinute),
    ) ??
      false);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  if (!plan) return null;
  const name = (id: string) => {
    const place = places.find((place) => place.id === id);
    return place
      ? `${place.displayName}${place.branch ? ` · ${place.branch}` : ""}`
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
  const chosenIds = selectedPlaceIds ?? plan.request.selectedPlaceIds;
  const notIncluded = places.filter(
    (place) => !plan.stops.some((stop) => stop.placeId === place.id),
  );
  const selectedPlace = places.find((place) => place.id === selectedId);
  return (
    <section aria-label="Generated day plan" className="import-job">
      <h3>Generated day plan</h3>
      <p>
        Shanghai · {plan.request.visitDate} · Requested travel:{" "}
        {plan.request.mode === "walking-transit"
          ? "Walking / public transit"
          : "Taxi / car"}{" "}
      </p>
      {plan.dataKind === "fixture" && (
        <p>
          Fictional development plan. No actual provider connectivity or venue
          verification.
        </p>
      )}
      {state.needsReview && (
        <p role="status">
          This saved plan needs review: the request, chosen Places or practical
          facts changed.
        </p>
      )}
      <p>
        {places.length} saved · {chosenIds.length} chosen · {plan.stops.length}{" "}
        included in this day. Saving keeps a Place for consideration; choosing
        it does not guarantee inclusion.
      </p>
      <p>
        Start, budget and dietary text are shared preferences, not verified
        travel or venue constraints.
      </p>
      {plan.manuallyEdited && (
        <p>
          Manual edits saved. Regeneration requires an explicit replacement
          choice.
        </p>
      )}
      <ol aria-label="Day stops">
        {plan.stops.map((stop, index) => (
          <li key={stop.placeId} className="day-stop">
            <h4>{name(stop.placeId)}</h4>
            <VisitFacts facts={visitFacts[stop.placeId]} />
            {!directionsAllowed(stop.placeId) && (
              <p>
                Saved address below is historical and unconfirmed. Current
                practical directions are unavailable.
              </p>
            )}
            <p className="day-local-address">
              {places.find((place) => place.id === stop.placeId)?.localName}
              <br />
              {places.find((place) => place.id === stop.placeId)?.address ??
                "Local address unavailable"}
            </p>
            {directionsAllowed(stop.placeId) &&
              places.find((place) => place.id === stop.placeId)?.address && (
                <button
                  type="button"
                  onClick={() => {
                    const place = places.find(
                      (place) => place.id === stop.placeId,
                    );
                    if (place) void copyAddress(place);
                  }}
                >
                  Copy local name and address
                </button>
              )}
            <button type="button" onClick={() => setSelectedId(stop.placeId)}>
              Review branch details
            </button>
            {stop.desiredArrivalMinute !== null &&
              stop.desiredArrivalMinute !== undefined && (
                <p>
                  User-desired arrival {clock(stop.desiredArrivalMinute)}{" "}
                  (Shanghai) · your requested arrangement, not a travel
                  estimate; verify feasibility.
                </p>
              )}
            {onEdit && (
              <div className="day-edit-actions">
                {state.needsReview && (
                  <p role="status">
                    Review changed inputs or chosen Places and regenerate before
                    editing this saved day.
                  </p>
                )}
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
                      value={
                        arrivalEdits[stop.placeId] ??
                        arrivalValue(stop.desiredArrivalMinute)
                      }
                      onChange={(event) =>
                        setArrivalEdits((current) => ({
                          ...current,
                          [stop.placeId]: event.target.value,
                        }))
                      }
                      disabled={busy || state.needsReview}
                    />
                  </label>
                  {arrivalEdits[stop.placeId] !== undefined &&
                    arrivalEdits[stop.placeId] !==
                      arrivalValue(stop.desiredArrivalMinute) && (
                      <p role="status">
                        Unsaved desired arrival. Save desired time to keep this
                        arrangement.
                      </p>
                    )}
                  <button type="submit" disabled={busy || state.needsReview}>
                    Save desired time
                  </button>
                </form>
              </div>
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
            <p>
              {stop.hoursEvidence ??
                "Opening hours unknown — check with the branch before visiting."}
            </p>
            {plan.travelLegs
              .filter((leg) => leg.toPlaceId === stop.placeId)
              .map((leg) => (
                <p key={leg.fromPlaceId}>
                  From {name(leg.fromPlaceId)}:{" "}
                  {leg.durationSeconds === null
                    ? "Travel time unknown; no qualified route."
                    : `${leg.durationSeconds / 60} estimated travel minutes · ${leg.actualSubmode ?? "Travel submode unknown"}`}
                </p>
              ))}
          </li>
        ))}
      </ol>
      {retainedArrivals.length > 0 && (
        <section
          aria-label="Retained unsaved arrivals"
          className="day-input-notice"
        >
          <h4>Review earlier arrival drafts</h4>
          <p>
            These unsaved arrangements belong to the earlier day or stop shown
            below. They have not been applied to the current plan. Copy or
            review each draft, then explicitly enter any suitable arrangement in
            the current day or discard it.
          </p>
          <ul>
            {retainedArrivals.map((draft) => (
              <li key={draft.key}>
                <p>
                  {draft.name} · {draft.visitDate} (Shanghai) · Unsaved desired
                  arrival {draft.value || "unset"}
                </p>
                <details className="day-disclosure">
                  <summary>Original draft identity</summary>
                  <p>
                    Place {draft.placeId} · Plan {draft.planId} · Revision{" "}
                    {draft.revision}
                  </p>
                </details>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${draft.name}\n${draft.visitDate} (Shanghai)\nDesired arrival: ${draft.value || "unset"}`,
                      );
                      setCopyNotice("Earlier arrival draft copied.");
                    } catch {
                      setCopyNotice(
                        "Could not copy automatically. Select and copy the earlier arrival draft shown here.",
                      );
                    }
                  }}
                >
                  Copy earlier arrival draft
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRetainedArrivals((current) =>
                      current.filter((kept) => kept.key !== draft.key),
                    )
                  }
                >
                  Discard earlier arrival draft
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {copyNotice && <p role="status">{copyNotice}</p>}
      {selectedPlace && (
        <section aria-label="Day stop branch details" className="import-job">
          <h4>{name(selectedPlace.id)}</h4>
          <VisitFacts facts={visitFacts[selectedPlace.id]} />
          {!directionsAllowed(selectedPlace.id) && (
            <p>
              Saved address below is historical and unconfirmed. Practical
              directions stay unavailable.
            </p>
          )}
          <p className="day-local-address">
            {selectedPlace.localName}
            <br />
            {selectedPlace.address ?? "Local address unavailable"}
          </p>
          <p>
            Exact map and navigation remain unavailable; address searches
            require branch confirmation.
          </p>
          <details className="day-disclosure">
            <summary>Branch identity and source evidence</summary>
            <p>
              Canonical Place: {selectedPlace.id}. Exact map and navigation
              remain unavailable; address searches require branch confirmation.
            </p>
            <a
              href={`/discover?placeId=${encodeURIComponent(selectedPlace.id)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open this canonical Place in discovery/map context (new tab)
            </a>
            <ul>
              {selectedPlace.evidence.map((evidence) => (
                <li key={evidence.id}>
                  <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">
                    {evidence.attribution}
                  </a>{" "}
                  · checked {evidence.capturedAt.slice(0, 10)}.{" "}
                  {evidence.limits}
                </li>
              ))}
            </ul>
            {selectedPlace.providerReferences.map((reference) =>
              directionsAllowed(selectedPlace.id) &&
              reference.url &&
              reference.qualification === "qualified" ? (
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
            <pre>
              {JSON.stringify(
                {
                  evidence: selectedPlace.evidence,
                  providerReferences: selectedPlace.providerReferences,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <button type="button" onClick={() => setSelectedId(null)}>
            Close branch details
          </button>
        </section>
      )}
      <section aria-label="Not included in this day">
        <h4>Not included in this day</h4>
        {notIncluded.length === 0 && plan.unscheduledPlaces.length === 0 ? (
          <p>All saved Places are included.</p>
        ) : (
          <ul>
            {notIncluded.map((place) => (
              <li key={place.id}>
                {name(place.id)}:{" "}
                {plan.unscheduledPlaces.find(
                  (stop) => stop.placeId === place.id,
                )?.reason ??
                  (chosenIds.includes(place.id)
                    ? "Chosen after this plan was saved; review and regenerate."
                    : "Saved, not chosen for this day.")}
                {plan.unscheduledPlaces.some(
                  (stop) => stop.placeId === place.id,
                ) && (
                  <>
                    <p>
                      {plan.unscheduledPlaces.find(
                        (stop) => stop.placeId === place.id,
                      )?.restoreEligibility === "current-check-required"
                        ? "Manually removed. Restore checks the saved day and keeps unknown hours and travel warnings."
                        : "Awaiting a fresh assessment of hours and the journey. Earlier or unknown exclusion reasons cannot be overridden."}
                    </p>
                    {onRestore && (
                      <button
                        type="button"
                        disabled={
                          busy ||
                          state.needsReview ||
                          !chosenIds.includes(place.id)
                        }
                        onClick={() => onRestore(place.id)}
                      >
                        Restore to this day
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
            {plan.unscheduledPlaces
              .filter(
                (stop) => !places.some((place) => place.id === stop.placeId),
              )
              .map((stop) => (
                <li key={stop.placeId}>
                  {name(stop.placeId)}: {stop.reason}
                </li>
              ))}
          </ul>
        )}
      </section>
      <h4>Warnings and conflicts</h4>
      <ul>
        {plan.warnings.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <details className="day-disclosure">
        <summary>Planning assumptions and technical evidence</summary>
        <p>
          Revision {plan.revision} · Plan {plan.id}
        </p>
        <p>{plan.explanation}</p>
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
        <pre>
          {JSON.stringify(
            {
              request: plan.request,
              requestRevision: plan.requestRevision,
              selectionRevision: plan.selectionRevision,
              travelLegs: plan.travelLegs,
              operatingHours: plan.operatingHours,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
