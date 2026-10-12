"use client";
import { useEffect, useRef, useState } from "react";
import type {
  GuestParticipant,
  InvitationManagement,
  SharedGuestTrip,
} from "@/shared/contracts";

class GuestRequestFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function requestJson(path: string, data?: unknown) {
  const response = await fetch(path, {
    cache: "no-store",
    ...(data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {}),
  });
  const value = await response.json();
  if (!response.ok)
    throw new GuestRequestFailure(
      value.error?.message ?? "The request could not be completed.",
      response.status,
    );
  return value;
}
function ParticipantList({
  participants,
}: {
  participants: GuestParticipant[];
}) {
  return (
    <section aria-label="Trip participants">
      <h3>Participants</h3>
      {participants.length ? (
        <ul>
          {participants.map((participant) => (
            <li key={participant.id}>
              {participant.displayName} · Guest {participant.displayNumber}
              {participant.accessActive ? "" : " — access ended"}
            </li>
          ))}
        </ul>
      ) : (
        <p>No guests have joined yet.</p>
      )}
      <p>
        Display names are unverified. Guest numbers distinguish people with the
        same name.
      </p>
    </section>
  );
}
export function InvitationControls({ tripId }: { tripId: string }) {
  const [state, setState] = useState<InvitationManagement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const retry = useRef<(() => Promise<void>) | null>(null);
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
      setError(
        `${failure instanceof Error ? failure.message : "Invitation request failed."} Retry explicitly. No new invitation state is confirmed.`,
      );
    } finally {
      setBusy(false);
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the parent keys this component to the selected Trip and data kind.
  useEffect(() => {
    void run(async () => {
      setState(await requestJson(`/api/trips/${tripId}/invitation`));
    });
  }, [tripId]);
  async function change(action: "create" | "disable" | "replace") {
    setState(await requestJson(`/api/trips/${tripId}/invitation`, { action }));
    setNotice(
      action === "create"
        ? "Invitation created."
        : action === "disable"
          ? "Invitation disabled. Existing guests from this link can no longer access the Trip."
          : "Invitation replaced. Previous link and guest access have ended.",
    );
  }
  async function copyInvitation(url: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    retry.current = null;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Invitation link copied.");
    } catch {
      setError(
        "Copy failed. Select and copy the invitation link manually, or retry Copy invitation link.",
      );
    } finally {
      setBusy(false);
    }
  }
  const invitation = state?.invitation;
  return (
    <section aria-label="Invitation and participants" className="import-job">
      <h3>Invite companions</h3>
      <p>
        Anyone holding this link can join without an account, and can forward
        it. Share it only with people you want to invite.
      </p>
      <p>
        Disabling or replacing the invitation stops old-link joins and ends
        existing guests’ access on their next request. Their historical
        attribution and your saved Trip are retained.
      </p>
      {busy && <p role="status">Waiting for invitation confirmation…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert" aria-label="Invitation request failed">
          <p>{error}</p>
          {retry.current && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (retry.current) void run(retry.current);
              }}
            >
              Retry invitation
            </button>
          )}
        </div>
      )}
      {state && !invitation && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => change("create"))}
        >
          Create invitation
        </button>
      )}
      {invitation && (
        <>
          <p>
            Invitation {invitation.state === "active" ? "active" : "disabled"}.
          </p>
          {invitation.state === "active" && (
            <>
              <label htmlFor="invitation-link">Invitation link</label>
              <input id="invitation-link" value={invitation.url} readOnly />
              <button
                type="button"
                disabled={busy}
                onClick={() => void copyInvitation(invitation.url)}
              >
                Copy invitation link
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => change("disable"))}
              >
                Disable invitation
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => change("replace"))}
          >
            Replace invitation
          </button>
        </>
      )}
      {state && <ParticipantList participants={state.participants} />}
    </section>
  );
}
export function GuestTrip({
  token,
  tripId,
}: {
  token?: string;
  tripId?: string;
}) {
  const [shared, setShared] = useState<SharedGuestTrip | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const retry = useRef<(() => Promise<void>) | null>(null);
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    retry.current = operation;
    try {
      await operation();
      retry.current = null;
    } catch (failure) {
      setShared(null);
      setAvailable(
        failure instanceof GuestRequestFailure &&
          failure.status === 400 &&
          !!token,
      );
      setError(
        failure instanceof Error
          ? failure.message
          : "Guest access could not be loaded. Retry explicitly.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    const value = await requestJson(
      token ? `/api/invitations/${token}` : `/api/guest-trips/${tripId}`,
    );
    setShared(value.shared);
    setAvailable(true);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: route identity is the initial request boundary.
  useEffect(() => {
    void run(load);
  }, [token, tripId]);
  return (
    <section className="import-workflow trip-workflow">
      {busy && <p role="status">Checking guest access…</p>}
      {error && (
        <div role="alert" aria-label="Guest access unavailable">
          <h2>Guest access unavailable</h2>
          <p>{error}</p>
          <p>
            No private Trip details are available here. Browser storage loss may
            require joining again with a current link.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (retry.current) void run(retry.current);
            }}
          >
            Retry guest request
          </button>
        </div>
      )}
      {!shared && available && token && (
        <>
          <h2>Join a Trip</h2>
          <p>
            This invitation grants guest participation. Anyone with the link may
            forward it. Names are unverified; the organiser controls invitations
            and final selections.
          </p>
          <p>
            Your guest identity returns in this browser for up to 30 days, while
            this invitation stays active. Disabling or replacing it ends this
            access. Losing browser storage can require rejoining.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = displayName;
              void run(async () => {
                const value = await requestJson(`/api/invitations/${token}`, {
                  displayName: name,
                });
                setShared(value.shared);
              });
            }}
          >
            <label htmlFor="guest-name">Display name</label>
            <input
              id="guest-name"
              required
              maxLength={160}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
            />
            <button type="submit" disabled={busy}>
              Join as guest
            </button>
          </form>
        </>
      )}
      {shared && (
        <section aria-label="Shared Trip">
          <h2>{shared.trip.title}</h2>
          <p>
            {shared.trip.city} · {shared.trip.selectedPlaceIds.length} selected
            by the organiser for a future day plan
          </p>
          <p>
            You are {shared.participant.displayName} · Guest{" "}
            {shared.participant.displayNumber}
          </p>
          {shared.trip.dataKind === "fixture" && (
            <p className="fixture-notice">
              Fictional scenario collection — application behaviour only.
            </p>
          )}
          <p>
            You can read the shared shortlist. Suggestions, comments, votes and
            day plans are not available yet. The organiser controls final
            selections.
          </p>
          <a href={`/shared-trips/${shared.trip.id}`} className="text-link">
            Return to this shared Trip
          </a>
          <button type="button" disabled={busy} onClick={() => void run(load)}>
            Refresh shared Trip
          </button>
          <ParticipantList participants={shared.participants} />
          {!shared.trip.savedPlaces.length && <p>No saved Places yet.</p>}
          {shared.trip.savedPlaces.map((member) => (
            <article key={member.placeId} className="import-candidate">
              <h3>{member.place.displayName}</h3>
              <p>
                {member.place.branch} · {member.place.address}
              </p>
              <p>
                Operating status: {member.place.operationStatus}.{" "}
                {member.place.price
                  ? `${member.place.price.currency} ${member.place.price.amount}`
                  : "Price unknown"}
                . {member.place.hours?.description ?? "Hours unknown"}.
              </p>
              <details>
                <summary>Shared sources and branch evidence</summary>
                {member.place.evidence.map((evidence) => (
                  <p key={evidence.id}>
                    <a
                      href={evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {evidence.attribution}
                    </a>{" "}
                    · {evidence.capturedAt.slice(0, 10)} · {evidence.limits}
                  </p>
                ))}
                {member.importedEvidence.map((evidence) => (
                  <div
                    key={`${evidence.source.id}:${evidence.extraction.codePointStart}`}
                  >
                    <p>Original wording: “{evidence.extraction.quote}”</p>
                    <p>User-selected branch; independent verification: no.</p>
                    <p>
                      <a
                        href={evidence.source.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Original article
                      </a>{" "}
                      · revision {evidence.source.revision}
                    </p>
                    <p>
                      {evidence.source.attribution} ·{" "}
                      <a
                        href={evidence.source.licenseUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {evidence.source.license}
                      </a>
                    </p>
                    <p>{evidence.source.changes}</p>
                    {evidence.source.historyUrl && (
                      <p>
                        <a
                          href={evidence.source.historyUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Contributor history
                        </a>
                      </p>
                    )}
                    {evidence.source.revisionUrl && (
                      <p>
                        <a
                          href={evidence.source.revisionUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Exact source revision
                        </a>
                      </p>
                    )}
                    <p>{evidence.source.limits}</p>
                  </div>
                ))}
                {member.place.providerReferences
                  .filter(
                    (reference) =>
                      reference.url && reference.qualification === "qualified",
                  )
                  .map((reference) => (
                    <p key={reference.url}>
                      <a
                        href={reference.url as string}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {reference.linkKind === "search"
                          ? "Search address on"
                          : "Open place on"}{" "}
                        {reference.provider}
                      </a>{" "}
                      · {reference.qualificationNotes}
                    </p>
                  ))}
                <p>
                  Address searches do not confirm a venue pin. Exact navigation
                  and live map matching remain unavailable.
                </p>
              </details>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}
