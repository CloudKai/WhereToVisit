"use client";
import { useEffect, useRef, useState } from "react";
import type { Collaboration, Place } from "@/shared/contracts";
import { textPolicies } from "@/shared/text-policy";
import { TextField } from "./text-field";
import type { WorkspaceActivity } from "./trip-workspace";

class ObsoleteResponse extends Error {}

class CollaborationFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function CollaborationPanel({
  tripId,
  dataKind,
  places,
  selectedPlaceIds = [],
  owner = false,
  onTripChanged,
  onDenied,
  onActivity,
  onPendingSuggestions,
}: {
  tripId: string;
  dataKind: "real" | "fixture";
  places: Place[];
  selectedPlaceIds?: string[];
  owner?: boolean;
  onTripChanged?: () => Promise<void>;
  onDenied?: () => void;
  onActivity?: (activity: WorkspaceActivity) => void;
  onPendingSuggestions?: (count: number) => void;
}) {
  const [state, setState] = useState<Collaboration | null>(null);
  const currentState = useRef<Collaboration | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const [refreshedAt, setRefreshedAt] = useState<string>("");
  const [changed, setChanged] = useState(false);
  const [candidates, setCandidates] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [branch, setBranch] = useState(""),
    [name, setName] = useState("");
  const [confirmations, setConfirmations] = useState<Record<string, string>>(
    {},
  );
  const [amendments, setAmendments] = useState<Record<string, string>>({});
  useEffect(() => {
    const commentDirty =
      !!state &&
      Object.entries(comments).some(
        ([placeId, text]) =>
          text !==
          (state.comments.find(
            (comment) =>
              comment.actorId === state.actorId && comment.placeId === placeId,
          )?.text ?? ""),
      );
    const suggestionDirty =
      !!state &&
      state.suggestions.some(
        (suggestion) =>
          (amendments[suggestion.id] !== undefined &&
            amendments[suggestion.id] !== suggestion.name) ||
          (!suggestion.place && !!confirmations[suggestion.id]),
      );
    onActivity?.({
      busy: busy || (!state && !error),
      error,
      dirty: commentDirty || suggestionDirty || !!branch || !!name,
      interrupted: retryMutation.current && (busy || !!retry.current),
      label: "Group",
    });
  }, [
    busy,
    error,
    state,
    comments,
    amendments,
    confirmations,
    branch,
    name,
    onActivity,
  ]);
  useEffect(() => {
    onPendingSuggestions?.(
      state?.suggestions.filter((suggestion) => suggestion.state === "pending")
        .length ?? 0,
    );
  }, [state, onPendingSuggestions]);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const retryMutation = useRef(false);
  const endpoint = `/api/${owner ? "trips" : "guest-trips"}/${tripId}/collaboration`;
  async function json(path: string, input?: unknown) {
    const scope = generation.current;
    const response = await fetch(path, {
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
    if (scope !== generation.current) throw new ObsoleteResponse();
    if (!response.ok)
      throw new CollaborationFailure(
        value.error?.message ?? "Collaboration request failed.",
        response.status,
      );
    return value;
  }
  async function run(operation: () => Promise<void>, mutation = false) {
    if (running.current) return;
    running.current = true;
    const scope = generation.current;
    setBusy(true);
    // Reading current state must not replace an interrupted write's retry.
    const interrupted = !mutation && retryMutation.current && !!retry.current;
    if (!interrupted) {
      setError("");
      retry.current = operation;
      retryMutation.current = mutation;
    }
    setNotice("");
    try {
      await operation();
      if (scope !== generation.current) return;
      if (!interrupted) retry.current = null;
    } catch (failure) {
      if (failure instanceof ObsoleteResponse || scope !== generation.current)
        return;
      if (
        failure instanceof CollaborationFailure &&
        [401, 404].includes(failure.status)
      ) {
        setState(null);
        onDenied?.();
      }
      setError(
        `${failure instanceof Error ? failure.message : "Collaboration failed."} No new change is confirmed. Retry explicitly.`,
      );
    } finally {
      if (scope === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  async function load() {
    const value = await json(endpoint);
    const previous = currentState.current;
    const next: Collaboration = value.collaboration;
    setChanged(!!previous && JSON.stringify(previous) !== JSON.stringify(next));
    setComments((current) => {
      const merged = { ...current };
      for (const place of places) {
        const saved = (snapshot: Collaboration | null) =>
          snapshot?.comments.find(
            (comment) =>
              comment.actorId === snapshot.actorId &&
              comment.placeId === place.id,
          )?.text ?? "";
        if (
          current[place.id] === undefined ||
          current[place.id] === saved(previous)
        )
          merged[place.id] = saved(next);
      }
      return merged;
    });
    currentState.current = next;
    setState(next);
    setRefreshedAt(new Date().toLocaleTimeString());
    setNotice(previous ? "Group refreshed. Unsaved drafts are kept." : "");
    const catalogue = await json("/api/catalogue?city=Shanghai");
    setCandidates(
      catalogue.status === "available" && catalogue.data.dataKind === dataKind
        ? catalogue.data.places
        : [],
    );
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: parent keys this component by authoritative Trip and data kind.
  useEffect(() => {
    void run(load);
    return () => {
      generation.current += 1;
      running.current = false;
    };
  }, [tripId, dataKind]);
  function change(data: Record<string, unknown>) {
    const input = { operationId: crypto.randomUUID(), ...data };
    void run(async () => {
      const value = await json(endpoint, input);
      currentState.current = value.collaboration;
      setState(value.collaboration);
      setRefreshedAt(new Date().toLocaleTimeString());
      setChanged(false);
      if (data.action === "comment")
        setComments((current) =>
          current[String(data.placeId)] === data.text
            ? {
                ...current,
                [String(data.placeId)]:
                  value.collaboration.comments.find(
                    (comment: Collaboration["comments"][number]) =>
                      comment.actorId === value.collaboration.actorId &&
                      comment.placeId === data.placeId,
                  )?.text ?? "",
              }
            : current,
        );
      if (data.action === "suggest") {
        if (data.placeId)
          setBranch((current) => (current === data.placeId ? "" : current));
        if (data.name)
          setName((current) => (current === data.name ? "" : current));
      }
      if (data.action === "amend")
        setAmendments((current) =>
          current[String(data.suggestionId)] === data.name
            ? {
                ...current,
                [String(data.suggestionId)]:
                  value.collaboration.suggestions.find(
                    (suggestion: Collaboration["suggestions"][number]) =>
                      suggestion.id === data.suggestionId,
                  )?.name ?? String(data.name),
              }
            : current,
        );
      if (["accept", "confirm"].includes(String(data.action)))
        await onTripChanged?.();
      setNotice("Collaboration change saved.");
    }, true);
  }
  const label = (actorId: string) =>
    actorId === "organiser"
      ? "Organiser"
      : (() => {
          const participant = state?.participants.find(
            (item) => item.id === actorId,
          );
          return participant
            ? `${participant.displayName} · Guest ${participant.displayNumber}${participant.accessActive ? "" : " — access ended"}`
            : "Previous guest";
        })();
  const choiceLabel = (choice?: string) =>
    choice === "must-go"
      ? "Must go"
      : choice === "interested"
        ? "Interested"
        : choice === "skip"
          ? "Skip"
          : "No vote";
  return (
    <section aria-label="Group decisions" className="import-job">
      <h3>Choose together</h3>
      <p>
        Preferences inform the organiser’s final selection. Must go is a
        preference, not a guarantee. The organiser generates the day plan from
        chosen Places; real timing and feasibility remain unresolved.
      </p>
      <p>
        You can edit only your own comments and pending suggestions. Display
        names are unverified; guest numbers identify each participant. Past
        contributions remain after access ends.
      </p>
      {refreshedAt && (
        <p>
          Last confirmed update: {refreshedAt}. Refresh to see new
          contributions.
        </p>
      )}
      {changed && (
        <p role="status">
          Group changed since your previous review. Review the preferences,
          comments and suggestions below.
        </p>
      )}
      {busy && <p role="status">Waiting for collaboration confirmation…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert" aria-label="Collaboration request failed">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (retry.current) void run(retry.current, retryMutation.current);
            }}
          >
            Retry collaboration
          </button>
        </div>
      )}
      {retryMutation.current && retry.current && error && (
        <p>
          The unconfirmed change keeps its original retry. Refresh can show
          current group decisions while keeping your drafts and retry.
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => void run(load)}>
        Refresh collaboration
      </button>
      {state && (
        <>
          {places.map((place) => {
            const branchLabel = place.branch ?? place.displayName;
            const votes = state.votes.filter(
              (vote) => vote.placeId === place.id,
            );
            const own = votes.find((vote) => vote.actorId === state.actorId);
            const ownComment = state.comments.find(
              (comment) =>
                comment.placeId === place.id &&
                comment.actorId === state.actorId,
            );
            return (
              <section
                key={place.id}
                aria-label={`Discussion for ${branchLabel}`}
                className="import-candidate"
              >
                <h4>
                  {place.displayName} · {branchLabel}
                </h4>
                <p>{place.address}</p>
                <p>
                  {selectedPlaceIds.includes(place.id)
                    ? "Chosen by organiser for day"
                    : "Outstanding decision: organiser has not chosen this Place for the day."}
                </p>
                <p>
                  {
                    state.comments.filter(
                      (comment) => comment.placeId === place.id,
                    ).length
                  }{" "}
                  comments to review ·{" "}
                  {
                    state.suggestions.filter(
                      (suggestion) =>
                        suggestion.place?.id === place.id &&
                        suggestion.state === "pending",
                    ).length
                  }{" "}
                  pending suggestions for this Place.
                </p>
                <p>
                  Must go{" "}
                  {votes.filter((vote) => vote.choice === "must-go").length} ·
                  Interested{" "}
                  {votes.filter((vote) => vote.choice === "interested").length}{" "}
                  · Skip {votes.filter((vote) => vote.choice === "skip").length}
                </p>
                <ul>
                  {[
                    "organiser",
                    ...state.participants.map((item) => item.id),
                  ].map((actorId) => (
                    <li key={actorId}>
                      {label(actorId)}:{" "}
                      {choiceLabel(
                        votes.find((vote) => vote.actorId === actorId)?.choice,
                      )}
                    </li>
                  ))}
                </ul>
                <label>
                  Your preference for {branchLabel}
                  <select
                    disabled={busy}
                    value={own?.choice ?? ""}
                    onChange={(event) =>
                      change({
                        action: "vote",
                        placeId: place.id,
                        choice: event.target.value || null,
                      })
                    }
                  >
                    <option value="">No vote</option>
                    <option value="must-go">Must go</option>
                    <option value="interested">Interested</option>
                    <option value="skip">Skip</option>
                  </select>
                </label>
                <ul>
                  {state.comments
                    .filter((comment) => comment.placeId === place.id)
                    .map((comment) => (
                      <li key={comment.id}>
                        {label(comment.actorId)}:{" "}
                        <span style={{ whiteSpace: "pre-wrap" }}>
                          {comment.text}
                        </span>
                      </li>
                    ))}
                </ul>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    change({
                      action: "comment",
                      placeId: place.id,
                      text: comments[place.id] ?? "",
                      ...(ownComment ? { commentId: ownComment.id } : {}),
                    });
                  }}
                >
                  <label htmlFor={`${tripId}-comment-${place.id}`}>
                    Your comment for {branchLabel}
                  </label>
                  <TextField
                    id={`${tripId}-comment-${place.id}`}
                    policy={textPolicies.comment}
                    value={comments[place.id] ?? ""}
                    onChange={(value) =>
                      setComments((current) => ({
                        ...current,
                        [place.id]: value,
                      }))
                    }
                  />
                  <button type="submit" disabled={busy}>
                    Save comment for {branchLabel}
                  </button>
                </form>
              </section>
            );
          })}
          <section aria-label="Place suggestions">
            <h4>Place suggestions</h4>
            <p>
              {
                state.suggestions.filter(
                  (suggestion) => suggestion.state === "pending",
                ).length
              }{" "}
              awaiting organiser review ·{" "}
              {
                state.suggestions.filter(
                  (suggestion) =>
                    suggestion.state === "accepted" && !suggestion.place,
                ).length
              }{" "}
              awaiting branch confirmation.
            </p>
            <p>
              Suggestions wait for organiser review. An unresolved name is a
              request, not a confirmed destination; acceptance alone cannot make
              it schedulable. Accepting a branch adds it to the shortlist; the
              organiser still chooses whether to include it in the day.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                change({ action: "suggest", placeId: branch });
              }}
            >
              <label>
                Canonical branch to suggest
                <select
                  required
                  value={branch}
                  disabled={busy}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  <option value="">Choose a branch and address</option>
                  {candidates.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.displayName} · {place.branch} · {place.address}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy || !branch}>
                Suggest canonical branch
              </button>
            </form>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                change({ action: "suggest", name });
              }}
            >
              <label htmlFor={`${tripId}-suggestion`}>
                Unresolved Place name
              </label>
              <TextField
                id={`${tripId}-suggestion`}
                policy={textPolicies.suggestion}
                value={name}
                onChange={setName}
              />
              <button type="submit" disabled={busy}>
                Suggest unresolved Place
              </button>
            </form>
            {!state.suggestions.length && <p>No suggestions yet.</p>}
            {state.suggestions.map((suggestion) => (
              <article className="import-candidate" key={suggestion.id}>
                <h5>
                  {suggestion.name}
                  {suggestion.place
                    ? ` · ${suggestion.place.branch}`
                    : " · Unresolved"}
                </h5>
                {suggestion.place && <p>{suggestion.place.address}</p>}
                <p>
                  {label(suggestion.actorId)} · {suggestion.state}
                  {suggestion.state === "accepted" && !suggestion.place
                    ? " · Awaiting explicit branch confirmation; unschedulable"
                    : ""}
                </p>
                {owner && suggestion.state === "pending" && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        change({
                          action: "accept",
                          suggestionId: suggestion.id,
                        })
                      }
                    >
                      Accept suggestion
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        change({
                          action: "reject",
                          suggestionId: suggestion.id,
                        })
                      }
                    >
                      Reject suggestion
                    </button>
                  </>
                )}
                {suggestion.actorId === state.actorId &&
                  suggestion.state === "pending" && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        change({
                          action: "amend",
                          suggestionId: suggestion.id,
                          name: amendments[suggestion.id] ?? suggestion.name,
                        });
                      }}
                    >
                      <label htmlFor={`${tripId}-amend-${suggestion.id}`}>
                        Amend your suggestion
                      </label>
                      <TextField
                        id={`${tripId}-amend-${suggestion.id}`}
                        policy={textPolicies.suggestion}
                        value={amendments[suggestion.id] ?? suggestion.name}
                        onChange={(value) =>
                          setAmendments((current) => ({
                            ...current,
                            [suggestion.id]: value,
                          }))
                        }
                      />
                      <p>
                        Amending the name makes this an unresolved request for
                        organiser review.
                      </p>
                      <button type="submit" disabled={busy}>
                        Save suggestion amendment
                      </button>
                    </form>
                  )}
                {owner &&
                  suggestion.state === "accepted" &&
                  !suggestion.place && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        change({
                          action: "confirm",
                          suggestionId: suggestion.id,
                          placeId: confirmations[suggestion.id],
                        });
                      }}
                    >
                      <label>
                        Confirm branch for {suggestion.name}
                        <select
                          required
                          disabled={busy}
                          value={confirmations[suggestion.id] ?? ""}
                          onChange={(event) =>
                            setConfirmations((current) => ({
                              ...current,
                              [suggestion.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">
                            Review and choose a branch and address
                          </option>
                          {candidates.map((place) => (
                            <option key={place.id} value={place.id}>
                              {place.displayName} · {place.branch} ·{" "}
                              {place.address}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={busy || !confirmations[suggestion.id]}
                      >
                        Confirm suggested branch
                      </button>
                    </form>
                  )}
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
