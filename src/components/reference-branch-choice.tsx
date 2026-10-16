"use client";
import { useState } from "react";
import type {
  ReferenceBranch,
  SocialReference,
} from "@/shared/social-reference";

export function ReferenceBranchChoice({
  reference,
  onChange,
}: {
  reference: SocialReference;
  onChange: (reference: SocialReference) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [candidates, setCandidates] = useState<ReferenceBranch[]>([]);
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  async function open() {
    setEditing(true);
    setRevision(reference.choiceRevision);
    setSelected("");
    setLoaded(false);
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const response = await fetch("/api/social-references/branches", {
        cache: "no-store",
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error?.message ??
            "Could not load the catalogue. Retry branch review.",
        );
      setCandidates(value.branches);
      setLoaded(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load the catalogue.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function confirm(branchId: string | null) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/social-references/${reference.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, expectedRevision: revision }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error?.message ??
            "Could not update your branch choice. Retry explicitly.",
        );
      onChange(value.reference);
      setEditing(false);
      setStatus(
        branchId
          ? "Your branch choice was saved in this browser."
          : "Your branch choice was cleared. The reference stays unresolved.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update your choice.",
      );
    } finally {
      setBusy(false);
    }
  }
  const chosen = candidates.find((branch) => branch.id === selected);
  return (
    <section
      className="reference-branch-choice"
      aria-label="Your branch choice"
    >
      <h4>Your branch choice</h4>
      {reference.branchChoice ? (
        reference.branchChoice.branch ? (
          <p>
            {reference.branchChoice.branch.displayName} —{" "}
            {reference.branchChoice.branch.address ?? "Address unknown"}
          </p>
        ) : (
          <p>
            Your previously chosen branch is currently unavailable. It has not
            been replaced. Change or clear your choice deliberately.
          </p>
        )
      ) : (
        <p>Unresolved — no branch chosen.</p>
      )}
      <p>
        This is your judgment, not an extracted or verified match, creator
        endorsement or social recommendation. It does not save to a Trip.
      </p>
      {!editing ? (
        <button type="button" onClick={() => void open()}>
          {reference.branchChoice
            ? "Change or clear branch choice"
            : "Review branch choices"}
        </button>
      ) : (
        <div aria-busy={busy}>
          <p>
            The limited catalogue may not contain your branch. Review the branch
            address and source limitations before confirming.
          </p>
          {loaded && (
            <>
              <label htmlFor={`branch-${reference.id}`}>
                Shanghai catalogue branch
              </label>
              <select
                id={`branch-${reference.id}`}
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose a branch to review</option>
                {candidates.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.displayName} — {branch.address ?? "Address unknown"}
                  </option>
                ))}
              </select>
              {candidates.length === 0 && (
                <p>
                  No branches are currently offered. Keep this reference
                  unresolved.
                </p>
              )}
            </>
          )}
          {chosen && (
            <div>
              <p>
                <strong>{chosen.displayName}</strong>
                <br />
                {chosen.address ?? "Address unknown"}
              </p>
              <details>
                <summary>Review catalogue sources and limits</summary>
                {chosen.sources.map((source) => (
                  <p key={source.sourceUrl}>
                    <a
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      Catalogue source (new tab)
                    </a>{" "}
                    · Checked {source.capturedAt}. {source.limits}
                  </p>
                ))}
              </details>
              <p>
                These catalogue facts are separate from your social link and
                note. Current operation and exact provider matching may remain
                unknown.
              </p>
            </div>
          )}
          {error && (
            <p role="alert">
              {error} Your local selection is retained. Refresh social drafts
              after a conflict, then cancel and reopen this review.
            </p>
          )}
          <div className="filter-actions">
            <button
              type="button"
              disabled={busy || !chosen}
              onClick={() => void confirm(selected)}
            >
              Confirm my branch choice
            </button>
            {reference.branchChoice && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirm(null)}
              >
                Confirm clear branch choice
              </button>
            )}
            {!loaded && (
              <button type="button" disabled={busy} onClick={() => void open()}>
                Retry branch review
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel — keep current choice
            </button>
          </div>
        </div>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
