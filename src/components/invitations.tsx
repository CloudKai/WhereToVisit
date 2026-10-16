"use client";
import { useEffect, useRef, useState } from "react";
import type {
  GuestParticipant,
  InvitationManagement,
  SharedGuestTrip,
} from "@/shared/contracts";
import { textPolicies } from "@/shared/text-policy";
import { CollaborationPanel } from "./collaboration";
import { SharedDayPlan } from "./day-plan";
import { ImportedEvidence } from "./imported-evidence";
import { TextField } from "./text-field";
import { TripWorkspace, type WorkspaceActivity } from "./trip-workspace";
import { VisitFacts } from "./visit-facts";

class ObsoleteInvitationResponse extends Error {}

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
export function InvitationControls({
  tripId,
  onActivity,
}: {
  tripId: string;
  onActivity?: (activity: WorkspaceActivity) => void;
}) {
  const [state, setState] = useState<InvitationManagement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const running = useRef(false);
  async function management(input?: unknown) {
    const scope = generation.current;
    const value = await requestJson(`/api/trips/${tripId}/invitation`, input);
    if (scope !== generation.current) throw new ObsoleteInvitationResponse();
    return value;
  }
  const retry = useRef<(() => Promise<void>) | null>(null);
  const retryMutation = useRef(false);
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
      if (
        failure instanceof ObsoleteInvitationResponse ||
        scope !== generation.current
      )
        return;
      setError(
        `${failure instanceof Error ? failure.message : "Invitation request failed."} Retry explicitly. No new invitation state is confirmed.`,
      );
    } finally {
      if (scope === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the parent keys this component to the selected Trip and data kind.
  useEffect(() => {
    void run(async () => {
      setState(await management());
    });
    return () => {
      generation.current += 1;
      running.current = false;
    };
  }, [tripId]);
  async function change(action: "create" | "disable" | "replace") {
    setState(await management({ action }));
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
  useEffect(() => {
    onActivity?.({
      busy: busy || (!state && !error),
      error,
      interrupted: retryMutation.current && (busy || !!retry.current),
      label: "Manage",
    });
  }, [busy, error, state, onActivity]);
  const invitation = state?.invitation;
  return (
    <section aria-label="Invitation and participants" className="import-job">
      <h3>Invite companions</h3>
      <p>
        Anyone holding this link can join without an account, and can forward
        it. Share it only with people you want to invite.
      </p>
      <p>
        Guest browser access expires up to 30 days after joining; returning does
        not extend it. An active invitation can be used to join again. “Access
        ended” means the invitation changed or the guest has no unexpired
        browser session; past attribution remains.
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
                if (retry.current)
                  void run(retry.current, retryMutation.current);
              }}
            >
              Retry invitation
            </button>
          )}
        </div>
      )}
      {retryMutation.current && retry.current && error && (
        <p>
          The unconfirmed invitation change keeps its retry while you refresh
          current access.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setState(await management());
            setNotice("Invitation and current guest access refreshed.");
          })
        }
      >
        Refresh invitation and participants
      </button>
      {state && !invitation && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => change("create"), true)}
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
                onClick={() => void run(() => change("disable"), true)}
              >
                Disable invitation
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => change("replace"), true)}
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
  const [groupActivity, setGroupActivity] = useState<WorkspaceActivity>({
    busy: true,
    error: "",
  });
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
            <TextField
              id="guest-name"
              policy={textPolicies.guestName}
              value={displayName}
              onChange={setDisplayName}
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
          {shared.trip.dataKind === "fixture" && (
            <p className="fixture-notice">
              Fictional scenario collection — application behaviour only.
            </p>
          )}
          <a
            href={`/shared-trips/${shared.trip.id}`}
            className="text-link"
            target="_blank"
            rel="noreferrer"
          >
            Open this shared Trip (new tab)
          </a>
          <button type="button" disabled={busy} onClick={() => void run(load)}>
            Refresh shared Trip
          </button>
          <TripWorkspace
            key={`${shared.trip.id}:${shared.trip.dataKind}:${shared.participant.id}`}
            workspaceId={`${shared.trip.id}:${shared.trip.dataKind}:${shared.participant.id}`}
            title={shared.trip.title}
            participantRole={`${shared.participant.displayName} · Guest ${shared.participant.displayNumber}`}
            savedCount={shared.trip.savedPlaces.length}
            selectedCount={shared.trip.selectedPlaceIds.length}
            activity={[{ busy, error }, groupActivity]}
            day={{
              visitDate: shared.trip.dayPlan.draft?.request.visitDate ?? null,
              includedIds:
                shared.trip.generatedDayPlan.plan?.stops.map(
                  (stop) => stop.placeId,
                ) ?? [],
              needsReview:
                shared.trip.dayPlan.needsReview ||
                shared.trip.generatedDayPlan.needsReview,
              hasDraft: !!shared.trip.dayPlan.draft,
              hasPlan: !!shared.trip.generatedDayPlan.plan,
            }}
          >
            {{
              places: (
                <section aria-label="Shared saved shortlist">
                  <h3>Saved shortlist</h3>
                  {!shared.trip.savedPlaces.length && (
                    <p>No saved Places yet.</p>
                  )}
                  {shared.trip.savedPlaces.map((member) => (
                    <article key={member.placeId} className="import-candidate">
                      <h3>{member.place.displayName}</h3>
                      <p>
                        Original saved branch/address: {member.place.branch} ·{" "}
                        {member.place.address}
                      </p>
                      <p>
                        Saved in shortlist ·{" "}
                        {shared.trip.selectedPlaceIds.includes(member.placeId)
                          ? "Chosen by organiser for day"
                          : "Not chosen for day"}{" "}
                        ·{" "}
                        {shared.trip.generatedDayPlan.plan?.stops.some(
                          (stop) => stop.placeId === member.placeId,
                        )
                          ? "Included in saved day"
                          : "Not included in saved day"}
                        {shared.trip.generatedDayPlan.needsReview
                          ? " — day needs review"
                          : ""}
                      </p>
                      <p>
                        Original saved operating status:{" "}
                        {member.place.operationStatus}.{" "}
                        {member.place.price
                          ? `${member.place.price.currency} ${member.place.price.amount}`
                          : "Price unknown"}
                        . {member.place.hours?.description ?? "Hours unknown"}.
                      </p>
                      <VisitFacts facts={member.visitFacts} />
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
                            · {evidence.capturedAt.slice(0, 10)} ·{" "}
                            {evidence.limits}
                          </p>
                        ))}
                        {member.importedEvidence.map((evidence) => (
                          <div
                            key={`${evidence.source.id}:${evidence.extraction.codePointStart}`}
                          >
                            <ImportedEvidence evidence={evidence} />
                          </div>
                        ))}
                        {member.place.providerReferences
                          .filter(
                            (reference) =>
                              !member.visitFacts?.identityReviewRequired &&
                              member.visitFacts?.fields.address.outcome ===
                                "checked" &&
                              reference.url &&
                              reference.qualification === "qualified",
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
                          Address searches do not confirm a venue pin. Exact
                          navigation and live map matching remain unavailable.
                        </p>
                      </details>
                    </article>
                  ))}
                </section>
              ),
              group: (
                <>
                  <p>
                    You can suggest Places, comment and vote. The organiser
                    controls final selections and one-day draft inputs.
                  </p>
                  <p>
                    Only the organiser can generate a day plan. Guests can read
                    the saved result. Live routes and real travel timings remain
                    unavailable.
                  </p>

                  <ParticipantList participants={shared.participants} />
                  <CollaborationPanel
                    key={`${shared.trip.id}:${shared.trip.dataKind}`}
                    tripId={shared.trip.id}
                    dataKind={shared.trip.dataKind}
                    selectedPlaceIds={shared.trip.selectedPlaceIds}
                    places={shared.trip.savedPlaces.map(
                      (member) => member.place,
                    )}
                    onActivity={setGroupActivity}
                    onDenied={() => {
                      setShared(null);
                      setAvailable(false);
                      setError(
                        "Guest access is unavailable. Ask the organiser for a current invitation.",
                      );
                      retry.current = load;
                    }}
                  />
                </>
              ),
              day: (
                <SharedDayPlan
                  selectedPlaceIds={shared.trip.selectedPlaceIds}
                  state={shared.trip.dayPlan}
                  generated={shared.trip.generatedDayPlan}
                  places={shared.trip.savedPlaces.map((member) => member.place)}
                  visitFacts={Object.fromEntries(
                    shared.trip.savedPlaces.map((member) => [
                      member.placeId,
                      member.visitFacts,
                    ]),
                  )}
                />
              ),
              manage: null,
            }}
          </TripWorkspace>
        </section>
      )}
    </section>
  );
}
