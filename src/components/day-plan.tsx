"use client";
import { useEffect, useRef, useState } from "react";
import type {
  DayPlanDraftState,
  DayPlanRequest,
  GeneratedDayPlanState,
  Place,
  SavedVisitFacts,
  Trip,
} from "@/shared/contracts";
import { textPolicies } from "@/shared/text-policy";
import { GeneratedDayPlan } from "./generated-day-plan";
import { TextField } from "./text-field";
import type { WorkspaceActivity, WorkspaceDay } from "./trip-workspace";
export function SharedDayPlan({
  state,
  generated,
  places,
  visitFacts,
  selectedPlaceIds,
}: {
  state: DayPlanDraftState;
  generated: GeneratedDayPlanState;
  places: Place[];
  visitFacts?: Record<string, SavedVisitFacts | undefined>;
  selectedPlaceIds: string[];
}) {
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
        Start, budget and dietary text are shared preferences, not verified
        travel or venue constraints.
      </p>
      <p>
        Guests can read this context. Only the organiser can change chosen stops
        or inputs or generate the itinerary.
      </p>
      <GeneratedDayPlan
        state={generated}
        places={places}
        visitFacts={visitFacts}
        selectedPlaceIds={selectedPlaceIds}
      />
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
  onWorkspaceDay,
  onActivity,
}: {
  trip: Trip;
  onDenied: () => void;
  onTripReload: () => Promise<void>;
  onWorkspaceDay?: (day: WorkspaceDay) => void;
  onActivity?: (activity: WorkspaceActivity) => void;
}) {
  const [generated, setGenerated] = useState<GeneratedDayPlanState>({
    plan: null,
    needsReview: false,
  });
  const [state, setState] = useState<DayPlanDraftState | null>(null);
  const [visitDate, setVisitDate] = useState("");
  const [startArea, setStartArea] = useState("");
  const [budget, setBudget] = useState("");
  const [dietaryNeeds, setDietaryNeeds] = useState("");
  const [pace, setPace] = useState<DayPlanRequest["pace"]>(null);
  const [mode, setMode] = useState<DayPlanRequest["mode"]>("walking-transit");
  const [replaceEdited, setReplaceEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const retry = useRef<(() => Promise<void>) | null>(null);
  const retryMutation = useRef(false);
  const [arrivalDirty, setArrivalDirty] = useState(false);
  const initialized = useRef(false);
  const selectionChanged =
    !!state && (trip.selectionRevision ?? 0) !== state.selectionRevision;
  const draftNeedsReview = !!state?.needsReview || selectionChanged;
  const saved = state?.draft?.request;
  const inputsDirty =
    !!state &&
    (visitDate !== (saved?.visitDate ?? "") ||
      startArea !== (saved?.startArea ?? "") ||
      budget !== (saved?.budget ?? "") ||
      dietaryNeeds !== (saved?.dietaryNeeds ?? "") ||
      pace !== (saved?.pace ?? null) ||
      mode !== (saved?.mode ?? "walking-transit"));
  useEffect(() => {
    onActivity?.({
      busy: busy || (!state && !error),
      error,
      dirty: inputsDirty || arrivalDirty,
      interrupted: retryMutation.current && (busy || !!retry.current),
      label: "Day",
    });
  }, [inputsDirty, busy, error, state, arrivalDirty, onActivity]);
  useEffect(() => {
    if (state)
      onWorkspaceDay?.({
        visitDate: state.draft?.request.visitDate ?? null,
        includedIds: generated.plan?.stops.map((stop) => stop.placeId) ?? [],
        needsReview: draftNeedsReview || generated.needsReview,
        hasDraft: !!state.draft,
        hasPlan: !!generated.plan,
      });
  }, [state, generated, draftNeedsReview, onWorkspaceDay]);
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
  async function run(operation: () => Promise<void>, mutation = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    retry.current = operation;
    retryMutation.current = mutation;
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
        `${failure instanceof Error ? failure.message : "The draft request failed."} No new change is confirmed saved.`,
      );
    } finally {
      setBusy(false);
    }
  }
  function applyRequest(
    draft?: DayPlanRequest,
    submitted?: Partial<DayPlanRequest>,
  ) {
    setVisitDate((current) =>
      !submitted || current === submitted.visitDate
        ? (draft?.visitDate ?? "")
        : current,
    );
    setStartArea((current) =>
      !submitted || current === (submitted.startArea ?? "")
        ? (draft?.startArea ?? "")
        : current,
    );
    setBudget((current) =>
      !submitted || current === (submitted.budget ?? "")
        ? (draft?.budget ?? "")
        : current,
    );
    setDietaryNeeds((current) =>
      !submitted || current === (submitted.dietaryNeeds ?? "")
        ? (draft?.dietaryNeeds ?? "")
        : current,
    );
    setPace((current) =>
      !submitted || current === submitted.pace
        ? (draft?.pace ?? null)
        : current,
    );
    setMode((current) =>
      !submitted || current === submitted.mode
        ? (draft?.mode ?? "walking-transit")
        : current,
    );
  }
  async function load(replaceFields: boolean) {
    const value = await request();
    if (replaceFields || !initialized.current) {
      applyRequest(value.draft?.request);
      initialized.current = true;
    }
    setState(value);
    const response = await fetch(`/api/trips/${trip.id}/generated-day-plan`, {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok)
      throw new DraftFailure(
        result.error?.message ?? "Plan unavailable.",
        response.status,
      );
    setGenerated(result.generatedDayPlan);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the parent keys this view to Trip/data kind; selection changes refresh its revision without discarding edited preferences.
  useEffect(() => {
    // Selection refresh must not replace an interrupted mutation identity.
    // Explicit retry acknowledges that operation under current authority/revisions.
    if (retryMutation.current && retry.current) return;
    void run(() => load(false));
  }, [trip.selectionRevision]);
  return (
    <section aria-label="Plan my day" className="import-job">
      <h3>Plan my day</h3>
      <GeneratedDayPlan
        selectedPlaceIds={trip.selectedPlaceIds}
        state={{
          ...generated,
          needsReview: generated.needsReview || selectionChanged,
        }}
        busy={busy}
        onEdit={(stops) => {
          const input = {
            operationId: crypto.randomUUID(),
            expectedRevision: generated.plan?.revision ?? 0,
            stops,
          };
          void run(async () => {
            const response = await fetch(
              `/api/trips/${trip.id}/generated-day-plan`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
                cache: "no-store",
              },
            );
            const result = await response.json();
            if (!response.ok)
              throw new DraftFailure(
                result.error?.message ?? "Editing unavailable.",
                response.status,
              );
            setGenerated(result.generatedDayPlan);
            setReplaceEdited(false);
            setNotice(
              "Day plan edits confirmed saved. Review warnings before visiting.",
            );
          }, true);
        }}
        onRestore={(placeId) => {
          const input = {
            operationId: crypto.randomUUID(),
            placeId,
            planId: generated.plan?.id,
            dataKind: trip.dataKind,
            expectedRevision: generated.plan?.revision,
            requestRevision: generated.plan?.requestRevision,
            selectionRevision: generated.plan?.selectionRevision,
          };
          void run(async () => {
            const response = await fetch(
              `/api/trips/${trip.id}/generated-day-plan/restore`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
                cache: "no-store",
              },
            );
            const result = await response.json();
            if (!response.ok)
              throw new DraftFailure(
                result.error?.message ?? "Restore unavailable.",
                response.status,
              );
            setGenerated(result.generatedDayPlan);
            setReplaceEdited(false);
            setNotice(
              "Restored stop confirmed saved. Review current hours and travel warnings before visiting.",
            );
          }, true);
        }}
        onDirtyChange={setArrivalDirty}
        places={trip.savedPlaces.map((member) => member.place)}
        visitFacts={Object.fromEntries(
          trip.savedPlaces.map((member) => [member.placeId, member.visitFacts]),
        )}
      />
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
        Exact maps and real routes remain unavailable.{" "}
        {generated.plan
          ? "Review the saved ordering, unresolved timing and warnings above."
          : "No schedule or travel timings have been generated."}
      </p>
      <p>
        Optional preferences can all be unset. Saved inputs are shared with
        invited guests. Dietary text records your preference; venue suitability
        and allergy safety are unknown.
      </p>
      {busy && <p role="status">Waiting for day request confirmation…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert" aria-label="Day plan request failed">
          <p>{error}</p>
          {retry.current && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (retry.current)
                  void run(retry.current, retryMutation.current);
              }}
            >
              Retry day request
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
            Reload day request
          </button>
        </div>
      )}
      {draftNeedsReview && (
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
              applyRequest(value.draft?.request, input);
              const response = await fetch(
                `/api/trips/${trip.id}/generated-day-plan`,
                { cache: "no-store" },
              );
              if (response.ok)
                setGenerated((await response.json()).generatedDayPlan);
              setNotice(
                value.needsReview
                  ? "The previous save was confirmed, but chosen Places now need review."
                  : "One-day draft saved. Review before generating a plan.",
              );
            }, true);
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
          <p id="day-shared-preferences" className="day-input-notice">
            Saved hotel/start area, budget and dietary needs are visible to
            invited guests. These are your preferences; start location, cost,
            venue suitability and allergy safety have not been verified.
          </p>
          <label htmlFor="day-start">Start area or hotel (optional)</label>
          <TextField
            id="day-start"
            policy={textPolicies.startArea}
            value={startArea}
            onChange={setStartArea}
          />
          <label htmlFor="day-budget">Budget (optional)</label>
          <TextField
            id="day-budget"
            policy={textPolicies.budget}
            value={budget}
            onChange={setBudget}
          />
          <label htmlFor="day-diet">Dietary needs (optional)</label>
          <TextField
            id="day-diet"
            policy={textPolicies.dietaryNeeds}
            value={dietaryNeeds}
            onChange={setDietaryNeeds}
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
          {inputsDirty && (
            <p role="status">
              Unsaved planning inputs. Save one-day draft before generating from
              these preferences.
            </p>
          )}
          <button type="submit" disabled={busy}>
            Save one-day draft
          </button>
        </form>
      )}
      {state?.draft && (
        <>
          {replaceEdited && (
            <div role="alert" aria-label="Replace manual edits">
              <p>
                Regeneration will replace the edited order, removed stops and
                desired times with a newly generated plan. The saved plan is
                retained if generation fails.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setReplaceEdited(false)}
              >
                Keep edited day plan
              </button>
            </div>
          )}
          {(inputsDirty || arrivalDirty) && (
            <p role="status">
              Unsaved inputs are not used in generation. Save planning inputs
              first. Earlier unsaved arrivals will be retained separately for
              review and will not be applied to a regenerated day.
            </p>
          )}
          {draftNeedsReview && (
            <p role="status">
              Review chosen Places and save one-day draft before generating.
            </p>
          )}
          <button
            type="button"
            disabled={busy || draftNeedsReview || inputsDirty}
            onClick={() => {
              if (generated.plan?.manuallyEdited && !replaceEdited) {
                setReplaceEdited(true);
                return;
              }
              const input = {
                operationId: crypto.randomUUID(),
                expectedRevision: generated.plan?.revision ?? 0,
                requestRevision: state.draft?.revision,
                selectionRevision: state.selectionRevision,
                ...(replaceEdited ? { replaceEdited: true } : {}),
              };
              void run(async () => {
                const response = await fetch(
                  `/api/trips/${trip.id}/generated-day-plan`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(input),
                    cache: "no-store",
                  },
                );
                const result = await response.json();
                if (!response.ok)
                  throw new DraftFailure(
                    result.error?.message ?? "Generation unavailable.",
                    response.status,
                  );
                setGenerated(result.generatedDayPlan);
                setReplaceEdited(false);
                setNotice(
                  "Day plan confirmed saved. Review warnings before visiting.",
                );
              }, true);
            }}
          >
            {replaceEdited ? "Replace edited day plan" : "Generate day plan"}
          </button>
        </>
      )}
    </section>
  );
}
