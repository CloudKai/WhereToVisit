"use client";
import { useEffect, useRef, useState } from "react";
import type { Collaboration, Place } from "@/shared/contracts";

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
  owner = false,
  onTripChanged,
  onDenied,
}: {
  tripId: string;
  dataKind: "real" | "fixture";
  places: Place[];
  owner?: boolean;
  onTripChanged?: () => Promise<void>;
  onDenied?: () => void;
}) {
  const [state, setState] = useState<Collaboration | null>(null);
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
  const retry = useRef<(() => Promise<void>) | null>(null);
  const endpoint = `/api/${owner ? "trips" : "guest-trips"}/${tripId}/collaboration`;
  async function json(path: string, input?: unknown) {
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
    if (!response.ok)
      throw new CollaborationFailure(
        value.error?.message ?? "Collaboration request failed.",
        response.status,
      );
    return value;
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
      setBusy(false);
    }
  }
  async function load() {
    const value = await json(endpoint);
    setState(value.collaboration);
    setComments(
      Object.fromEntries(
        value.collaboration.comments
          .filter(
            (comment: Collaboration["comments"][number]) =>
              comment.actorId === value.collaboration.actorId,
          )
          .map((comment: Collaboration["comments"][number]) => [
            comment.placeId,
            comment.text,
          ]),
      ),
    );
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
  }, [tripId, dataKind]);
  function change(data: Record<string, unknown>) {
    const input = { operationId: crypto.randomUUID(), ...data };
    void run(async () => {
      const value = await json(endpoint, input);
      setState(value.collaboration);
      if (["accept", "confirm"].includes(String(data.action)))
        await onTripChanged?.();
      setNotice("Collaboration change saved.");
    });
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
        preference, not a guarantee. Generated schedules are not available yet.
      </p>
      {busy && <p role="status">Waiting for collaboration confirmation…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert" aria-label="Collaboration request failed">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (retry.current) void run(retry.current);
            }}
          >
            Retry collaboration
          </button>
        </div>
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
                        {label(comment.actorId)}: {comment.text}
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
                  <label>
                    Your comment for {branchLabel}
                    <textarea
                      required
                      maxLength={2000}
                      value={comments[place.id] ?? ""}
                      onChange={(event) =>
                        setComments((current) => ({
                          ...current,
                          [place.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
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
              Suggestions wait for organiser review. An unresolved name is a
              request, not a confirmed destination; acceptance alone cannot make
              it schedulable.
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
              <label>
                Unresolved Place name
                <input
                  required
                  maxLength={240}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
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
                      <label>
                        Amend your suggestion
                        <input
                          required
                          maxLength={240}
                          value={amendments[suggestion.id] ?? suggestion.name}
                          onChange={(event) =>
                            setAmendments((current) => ({
                              ...current,
                              [suggestion.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
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
