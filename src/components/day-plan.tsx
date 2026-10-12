"use client";
import { useEffect, useRef, useState } from "react";
import type {
  DayPlanDraftState,
  DayPlanRequest,
  Trip,
} from "@/shared/contracts";
export function SharedDayPlan({ state }: { state: DayPlanDraftState }) {
  const draft = state.draft;
  return (
    <section aria-label="Shared day-plan context" className="import-job">
      <h3>Organiser's one-day draft</h3>
      {draft ? (
        <>
          <p>
            Shanghai visit date: {draft.request.visitDate} ·{" "}
            {draft.request.selectedPlaceIds.length} chosen Places ·{" "}
            {draft.request.mode === "walking-transit"
              ? "Walking / public transit"
              : "Taxi / car"}
          </p>
          <p>
            Start area or hotel: {draft.request.startArea ?? "Unset"}. Budget:{" "}
            {draft.request.budget ?? "Unset"}. Dietary needs:{" "}
            {draft.request.dietaryNeeds ?? "Unset"}. Pace:{" "}
            {draft.request.pace ?? "Unset"}.
          </p>
          {state.needsReview && (
            <p>
              The organiser's selection changed. This draft needs review before
              generation.
            </p>
          )}
        </>
      ) : (
        <p>The organiser has not saved a day draft yet.</p>
      )}
      <p>
        Guests can read this context. Only the organiser can change chosen stops
        or inputs. No schedule or travel timings have been generated.
      </p>
    </section>
  );
}
class DraftFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function DayPlanInputs({
  trip,
  onDenied,
  onTripReload,
}: {
  trip: Trip;
  onDenied: () => void;
  onTripReload: () => Promise<void>;
}) {
  const [state, setState] = useState<DayPlanDraftState | null>(null);
  const [visitDate, setVisitDate] = useState("");
  const [startArea, setStartArea] = useState("");
  const [budget, setBudget] = useState("");
  const [dietaryNeeds, setDietaryNeeds] = useState("");
  const [pace, setPace] = useState<DayPlanRequest["pace"]>(null);
  const [mode, setMode] = useState<DayPlanRequest["mode"]>("walking-transit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const retry = useRef<(() => Promise<void>) | null>(null);
  const initialized = useRef(false);
  async function request(input?: unknown) {
    const response = await fetch(`/api/trips/${trip.id}/day-plan`, {
      cache: "no-store",
      ...(input
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }
        : {}),
    });
    const value = await response.json();
    if (!response.ok)
      throw new DraftFailure(
        value.error?.message ?? "Day draft unavailable.",
        response.status,
      );
    return value.dayPlan as DayPlanDraftState;
  }
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    retry.current = operation;
    try {
      await operation();
      retry.current = null;
    } catch (failure) {
      if (
        failure instanceof DraftFailure &&
        [401, 404].includes(failure.status)
      ) {
        setState(null);
        onDenied();
      }
      if (failure instanceof DraftFailure && failure.status !== 503)
        retry.current = null;
      setError(
        `${failure instanceof Error ? failure.message : "The draft request failed."} No new draft is confirmed saved.`,
      );
    } finally {
      setBusy(false);
    }
  }
  function applyRequest(draft?: DayPlanRequest) {
    setVisitDate(draft?.visitDate ?? "");
    setStartArea(draft?.startArea ?? "");
    setBudget(draft?.budget ?? "");
    setDietaryNeeds(draft?.dietaryNeeds ?? "");
    setPace(draft?.pace ?? null);
    setMode(draft?.mode ?? "walking-transit");
  }
  async function load(replaceFields: boolean) {
    const value = await request();
    setState(value);
    if (replaceFields || !initialized.current) {
      applyRequest(value.draft?.request);
      initialized.current = true;
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the parent keys this view to Trip/data kind; selection changes refresh its revision without discarding edited preferences.
  useEffect(() => {
    void run(() => load(false));
  }, [trip.selectionRevision]);
  return (
    <section aria-label="Plan my day" className="import-job">
      <h3>Plan my day</h3>
      <p>
        Choose confirmed branches in your saved shortlist, then save inputs for
        one Shanghai day. Votes are guidance; solo planning needs no votes.
      </p>
      <p>
        {trip.selectedPlaceIds.length} confirmed Places selected. Unresolved
        requests cannot be stops. In Group decisions, review the name and
        explicitly confirm a canonical branch and address, then select it above.
        Deselect any branch you do not want to plan.
      </p>
      <p>
        Exact maps and routes remain unavailable. No schedule or travel timings
        have been generated.
      </p>
      <p>
        Optional preferences can all be unset. Saved inputs are shared with
        invited guests. Dietary text records your preference; venue suitability
        and allergy safety are unknown.
      </p>
      {busy && <p role="status">Waiting for day draft confirmation…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert" aria-label="Day draft request failed">
          <p>{error}</p>
          {retry.current && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (retry.current) void run(retry.current);
              }}
            >
              Retry day draft
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onTripReload();
                await load(true);
              })
            }
          >
            Reload day draft
          </button>
        </div>
      )}
      {state?.needsReview && (
        <p role="status">
          Chosen Places changed since this draft. Review your selections and
          save the draft again.
        </p>
      )}
      {state && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = {
              operationId: crypto.randomUUID(),
              expectedRevision: state.draft?.revision ?? 0,
              selectionRevision: state.selectionRevision,
              visitDate,
              startArea: startArea || null,
              budget: budget || null,
              dietaryNeeds: dietaryNeeds || null,
              pace,
              mode,
            };
            void run(async () => {
              const value = await request(input);
              setState(value);
              applyRequest(value.draft?.request);
              setNotice(
                value.needsReview
                  ? "The previous save was confirmed, but chosen Places now need review."
                  : "One-day draft saved. Generation is not available yet.",
              );
            });
          }}
        >
          <label htmlFor="day-visit-date">Visit date (Shanghai)</label>
          <input
            id="day-visit-date"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            required
            value={visitDate}
            onChange={(event) => setVisitDate(event.target.value)}
          />
          <label htmlFor="day-start">Start area or hotel (optional)</label>
          <input
            id="day-start"
            maxLength={400}
            value={startArea}
            onChange={(event) => setStartArea(event.target.value)}
          />
          <label htmlFor="day-budget">Budget (optional)</label>
          <input
            id="day-budget"
            maxLength={240}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
          <label htmlFor="day-diet">Dietary needs (optional)</label>
          <input
            id="day-diet"
            maxLength={1000}
            value={dietaryNeeds}
            onChange={(event) => setDietaryNeeds(event.target.value)}
          />
          <label htmlFor="day-pace">Pace (optional)</label>
          <select
            id="day-pace"
            value={pace ?? ""}
            onChange={(event) =>
              setPace((event.target.value || null) as DayPlanRequest["pace"])
            }
          >
            <option value="">Unset</option>
            <option value="relaxed">Relaxed</option>
            <option value="balanced">Balanced</option>
            <option value="busy">Busy</option>
          </select>
          <label htmlFor="day-mode">Transport</label>
          <select
            id="day-mode"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as DayPlanRequest["mode"])
            }
          >
            <option value="walking-transit">Walking / public transit</option>
            <option value="taxi-car">Taxi / car</option>
          </select>
          <button type="submit" disabled={busy}>
            Save one-day draft
          </button>
        </form>
      )}
    </section>
  );
}
