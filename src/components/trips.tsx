"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Trip, TripSaveIntent } from "@/shared/contracts";
import { CollaborationPanel } from "./collaboration";
import { DayPlanInputs } from "./day-plan";
import { ImportedEvidence } from "./imported-evidence";
import { InvitationControls } from "./invitations";
import {
  TripWorkspace,
  type WorkspaceActivity,
  type WorkspaceDay,
} from "./trip-workspace";
import { VisitFacts } from "./visit-facts";

type Identity = { id: string; email: string };
export function TripDashboard({
  placeId,
  importId,
  pendingIntentId,
}: {
  placeId?: string;
  importId?: string;
  pendingIntentId?: string;
}) {
  const [user, setUser] = useState<Identity | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState("");
  const [intent, setIntent] = useState<TripSaveIntent | null>(null);
  const [intentId, setIntentId] = useState(pendingIntentId ?? "");
  const [pendingPreview, setPendingPreview] = useState<TripSaveIntent | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [dayReport, setDayReport] = useState<{
    scope: string;
    data: WorkspaceDay;
  }>();
  const [dayActivity, setDayActivity] = useState<WorkspaceActivity>({
    busy: true,
    error: "",
  });
  const [groupActivity, setGroupActivity] = useState<WorkspaceActivity>({
    busy: true,
    error: "",
  });
  const [invitationActivity, setInvitationActivity] =
    useState<WorkspaceActivity>({ busy: true, error: "" });
  const [suggestions, setSuggestions] = useState(0);
  const lastTitle = useRef<{ scope: string; title: string } | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const initialSave = useRef<{
    placeId: string;
    importId?: string;
    request: Promise<{ intent: TripSaveIntent }>;
  } | null>(null);
  async function json(path: string, data?: unknown) {
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
      throw new Error(
        value.error?.message ??
          value.message ??
          "The request could not be completed.",
      );
    return value;
  }
  async function run(
    operation: () => Promise<void>,
    isCurrent?: () => boolean,
    retryOperation = operation,
  ) {
    const current = isCurrent ?? (() => true);
    // A route bootstrap replaces its cancelled predecessor even while busy.
    // User actions remain serialized by the current busy state.
    if ((busy && !isCurrent) || !current()) return;
    setBusy(true);
    setError("");
    setNotice("");
    retry.current = retryOperation;
    try {
      await operation();
      if (current()) retry.current = null;
    } catch (failure) {
      if (current())
        setError(
          `${failure instanceof Error ? failure.message : "The request failed."} Retry to try again. Nothing new is confirmed saved.`,
        );
    } finally {
      if (current()) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  async function load(pendingId = intentId, isCurrent = () => true) {
    const response = await fetch("/api/trips", { cache: "no-store" });
    if (!isCurrent()) return;
    if (response.status === 401) {
      setUser(null);
      setTrips([]);
      setTripId("");
      setIntent(null);
      setTitle("");
      setEditTitle("");
      return;
    }
    const value = await response.json();
    if (!isCurrent()) return;
    if (!response.ok)
      throw new Error(value.error?.message ?? "Trips are unavailable.");
    setUser(value.user);
    setTrips(value.trips);
    setTripId((current) =>
      value.trips.some(
        (item: Trip) =>
          item.id === current ||
          (!current &&
            item.id ===
              new URLSearchParams(window.location.search).get("tripId")),
      )
        ? current ||
          new URLSearchParams(window.location.search).get("tripId") ||
          ""
        : (value.trips[0]?.id ?? ""),
    );
    setIntent(null);
    if (pendingId) {
      const pending = await json(`/api/trip-save-intents/${pendingId}`);
      if (isCurrent()) {
        setIntent(pending.intent);
        setPendingPreview(pending.intent);
      }
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial request helpers intentionally use the route values only.
  useEffect(() => {
    let active = true;
    void run(
      async () => {
        let pending = pendingIntentId ?? "";
        if (placeId && !pending) {
          // Repeated effect setup shares one request so anonymous cookie creation
          // cannot race two separate save intents for the same continuation.
          if (
            initialSave.current?.placeId !== placeId ||
            initialSave.current?.importId !== importId
          ) {
            initialSave.current = {
              placeId,
              importId,
              request: json("/api/trip-save-intents", {
                placeId,
                ...(importId ? { importId } : {}),
              }),
            };
          }
          try {
            const value = await initialSave.current.request;
            pending = value.intent.id;
            if (active) {
              setIntentId(pending);
              setPendingPreview(value.intent);
              const params = new URLSearchParams(window.location.search);
              params.set("intentId", pending);
              window.history.replaceState(null, "", `?${params.toString()}`);
            }
          } catch (failure) {
            initialSave.current = null;
            if (active) {
              setIntentId("");
              setIntent(null);
              await load("", () => active);
              throw failure;
            }
          }
        }
        if (active) {
          setIntentId(pending);
          await load(pending, () => active);
        }
      },
      () => active,
    );
    return () => {
      active = false;
    };
  }, [placeId, importId, pendingIntentId]);
  const trip = trips.find((item) => item.id === tripId);
  const scope = `${user?.id}:${trip?.id}:${trip?.dataKind}`;
  const day = dayReport?.scope === scope ? dayReport.data : undefined;
  const reportDay = useCallback(
    (data: WorkspaceDay) => {
      setDayReport({ scope, data });
    },
    [scope],
  );
  useEffect(() => {
    const previous = lastTitle.current;
    const serverTitle = trip?.title ?? "";
    setEditTitle((current) =>
      previous?.scope === scope && current !== previous.title
        ? current
        : serverTitle,
    );
    lastTitle.current = { scope, title: serverTitle };
  }, [scope, trip?.title]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports reset at the authoritative workspace scope boundary.
  useEffect(() => {
    setDayReport(undefined);
    setDayActivity({ busy: true, error: "" });
    setGroupActivity({ busy: true, error: "" });
    setInvitationActivity({ busy: true, error: "" });
    setSuggestions(0);
  }, [trip?.id, trip?.dataKind, user?.id]);
  useEffect(() => {
    if (!tripId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tripId") === tripId) return;
    params.set("tripId", tripId);
    window.history.replaceState(
      window.history.state,
      "",
      `?${params.toString()}`,
    );
  }, [tripId]);
  function leaveTrip() {
    return (
      !trip ||
      !(
        editTitle !== trip.title ||
        busy ||
        dayActivity.dirty ||
        dayActivity.interrupted ||
        groupActivity.dirty ||
        groupActivity.interrupted ||
        invitationActivity.interrupted
      ) ||
      window.confirm(
        "Change Trip or account? Unsaved workspace fields and interrupted-request retries will be discarded. Saved changes stay saved.",
      )
    );
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: actual current dirty/pending reports govern the boundary choice.
  useEffect(() => {
    function onHistory() {
      const requested = new URLSearchParams(window.location.search).get(
        "tripId",
      );
      if (
        !requested ||
        requested === tripId ||
        !trips.some((item) => item.id === requested)
      )
        return;
      if (!leaveTrip()) {
        const params = new URLSearchParams(window.location.search);
        params.set("tripId", tripId);
        window.history.replaceState(null, "", `?${params.toString()}`);
        return;
      }
      setTripId(requested);
    }
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, [
    tripId,
    trips,
    editTitle,
    busy,
    error,
    dayActivity,
    groupActivity,
    invitationActivity,
  ]);
  async function mutate(data: unknown) {
    const value = await json(`/api/trips/${tripId}`, data);
    setTrips((current) =>
      current.map((item) => (item.id === value.trip.id ? value.trip : item)),
    );
    if ((data as { action?: string }).action === "update") {
      const submitted = (data as { title: string }).title;
      setEditTitle((current) =>
        current === submitted ? value.trip.title : current,
      );
    }
    setNotice("Trip changes saved.");
  }
  return (
    <section className="trip-workflow import-workflow">
      {loading && <p role="status">Loading your account and Trips…</p>}
      {error && (
        <div role="alert" aria-label="Trip request failed">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (retry.current) void run(retry.current);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {busy && <p role="status">Waiting for the server to confirm…</p>}
      {notice && <p role="status">{notice}</p>}
      {!loading && !user && (
        <section aria-label="Organiser account" className="account-entry">
          <h2>{register ? "Create an account to save" : "Sign in to save"}</h2>
          {pendingPreview && (
            <p>
              Pending branch:{" "}
              <strong>
                {pendingPreview.place.displayName} ·{" "}
                {pendingPreview.place.branch}
              </strong>
            </p>
          )}
          <p>
            After account entry, review your branch and destination Trip before
            Save.
          </p>
          <p>
            Email is unverified. Password recovery is unavailable; keep your
            password safe.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRegister(!register)}
          >
            {register ? "Use an existing account" : "Create an account"}
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                let entered = false;
                const enter = async () => {
                  if (!entered) {
                    await json(
                      `/api/auth/${register ? "sign-up" : "sign-in"}/email`,
                      {
                        email,
                        password,
                        ...(register ? { name: "Trip organiser" } : {}),
                      },
                    );
                    entered = true;
                    setPassword("");
                  }
                  await load();
                };
                retry.current = enter;
                await enter();
              });
            }}
          >
            <label htmlFor="organiser-email">Email</label>
            <input
              id="organiser-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <label htmlFor="organiser-password">Password</label>
            <input
              id="organiser-password"
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              {register ? "Create account" : "Sign in"}
            </button>
          </form>
        </section>
      )}
      {user && (
        <>
          {!trip && (
            <details className="trip-chooser">
              <summary>Manage account</summary>
              <p>
                Signed in as <strong>{user.email}</strong>. Your Trips are
                private.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await json("/api/auth/sign-out", {});
                    setIntent(null);
                    await load();
                  })
                }
              >
                Sign out
              </button>
            </details>
          )}
          <details open={!trips.length || !!intent} className="trip-chooser">
            <summary>Choose or create a Trip</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!leaveTrip()) return;
                void run(async () => {
                  const value = await json("/api/trips", {
                    title,
                    city: "Shanghai",
                  });
                  setTrips((current) => [value.trip, ...current]);
                  setTripId(value.trip.id);
                  const params = new URLSearchParams(window.location.search);
                  params.set("tripId", value.trip.id);
                  params.delete("view");
                  window.history.replaceState(
                    null,
                    "",
                    `?${params.toString()}`,
                  );
                  setTitle("");
                  setNotice(
                    "Private Trip created. Review its destination before Save.",
                  );
                });
              }}
            >
              <label htmlFor="new-trip-title">New Trip title</label>
              <input
                id="new-trip-title"
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <p>Destination: Shanghai</p>
              <button disabled={busy} type="submit">
                Create Trip
              </button>
            </form>
            {trips.length > 0 && (
              <>
                <label htmlFor="trip-choice">Your Trip</label>
                <select
                  id="trip-choice"
                  disabled={busy}
                  value={tripId}
                  onChange={(event) => {
                    if (!leaveTrip()) return;
                    setTripId(event.target.value);
                    const params = new URLSearchParams(window.location.search);
                    params.set("tripId", event.target.value);
                    params.delete("view");
                    window.history.replaceState(
                      null,
                      "",
                      `?${params.toString()}`,
                    );
                  }}
                >
                  {trips.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </>
            )}
          </details>
          {intent && (
            <section aria-label="Pending save" className="import-job">
              <h2>Review your pending save</h2>
              <p>
                {intent.place.displayName} · {intent.place.branch}
              </p>
              <p>{intent.place.address}</p>
              <p>
                Account: <strong>{user.email}</strong>
              </p>
              <p>
                Destination:{" "}
                {trip ? (
                  <strong>{trip.title}</strong>
                ) : (
                  "Choose or create a Trip above."
                )}
                {trip && ` · ${trip.city}`}
              </p>
              <p>
                {intent.importedEvidence.length} original source mentions will
                be retained. Signing in and creating a Trip do not save this
                branch.
              </p>
              {intent.dataKind === "fixture" && (
                <p className="fixture-notice">
                  Fictional scenario branch — not a real venue.
                </p>
              )}
              <button
                disabled={busy || !trip || !!error}
                type="button"
                onClick={() =>
                  void run(
                    async () => {
                      await mutate({ action: "save", intentId });
                      setIntent(null);
                      setPendingPreview(null);
                      setIntentId("");
                      const params = new URLSearchParams(
                        window.location.search,
                      );
                      params.delete("intentId");
                      params.delete("placeId");
                      params.delete("importId");
                      params.set("tripId", tripId);
                      window.history.replaceState(
                        null,
                        "",
                        `/trips?${params.toString()}`,
                      );
                      setNotice(`Reviewed branch saved to “${trip?.title}”.`);
                    },
                    undefined,
                    async () => {
                      await load();
                      setNotice(
                        "Review the account and destination again, then choose Save. A previous interrupted Save may already be present in the shortlist.",
                      );
                    },
                  )
                }
              >
                Save reviewed branch
              </button>
            </section>
          )}
          {trip && (
            <TripWorkspace
              key={`${user.id}:${trip.id}:${trip.dataKind}`}
              workspaceId={`${trip.id}:${trip.dataKind}:organiser`}
              title={trip.title}
              participantRole="Organiser"
              owner
              savedCount={trip.savedPlaces.length}
              selectedCount={trip.selectedPlaceIds.length}
              day={day}
              pendingSuggestions={suggestions}
              activity={[
                {
                  busy,
                  error,
                  dirty: editTitle !== trip.title,
                  interrupted: busy || !!error,
                  label: "Manage",
                },
                dayActivity,
                groupActivity,
                invitationActivity,
              ]}
            >
              {{
                manage: (
                  <>
                    <p>
                      Signed in as <strong>{user.email}</strong>. Your Trips are
                      private.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!leaveTrip()) return;
                        void run(async () => {
                          await json("/api/auth/sign-out", {});
                          setIntent(null);
                          await load();
                        });
                      }}
                    >
                      Sign out
                    </button>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(() =>
                          mutate({
                            action: "update",
                            title: editTitle,
                            city: "Shanghai",
                          }),
                        );
                      }}
                    >
                      <label htmlFor="trip-title">Trip title</label>
                      <input
                        id="trip-title"
                        required
                        maxLength={120}
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                      />
                      <button type="submit" disabled={busy}>
                        Update title
                      </button>
                    </form>
                    <InvitationControls
                      key={`${trip.id}:${trip.dataKind}`}
                      tripId={trip.id}
                      onActivity={setInvitationActivity}
                    />
                  </>
                ),
                places: (
                  <section aria-label="Saved shortlist" className="import-job">
                    <h3>Saved shortlist</h3>
                    <p>
                      {trip.savedPlaces.length} saved Places ·{" "}
                      {trip.selectedPlaceIds.length} chosen for the day. Saving,
                      day selection and included day stops are separate.
                    </p>
                    {trip.dataKind === "fixture" && (
                      <p className="fixture-notice">
                        Fictional scenario collection — application behaviour
                        only.
                      </p>
                    )}
                    <a href="/discover" className="text-link">
                      Add Places from Discover →
                    </a>
                    {!trip.savedPlaces.length && (
                      <p>
                        No saved Places yet. Browse discovery or confirm an
                        imported branch.
                      </p>
                    )}
                    {trip.savedPlaces.map((member) => (
                      <article
                        className="import-candidate"
                        key={member.placeId}
                      >
                        <h3>{member.place.displayName}</h3>
                        {member.visitFacts?.identityReviewRequired && (
                          <p role="alert">
                            Address needs same-branch identity review. Saved
                            branch and directions are historical and
                            unconfirmed.
                          </p>
                        )}
                        <p>
                          Original saved branch/address: {member.place.branch} ·{" "}
                          {member.place.address}
                        </p>
                        <label>
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={trip.selectedPlaceIds.includes(
                              member.placeId,
                            )}
                            onChange={(event) => {
                              const selected = event.target.checked;
                              void run(() =>
                                mutate({
                                  action: "select",
                                  placeId: member.placeId,
                                  selected,
                                }),
                              );
                            }}
                          />
                          Select{" "}
                          {member.place.branch ?? member.place.displayName} for
                          a day plan
                        </label>
                        <p>
                          Saved in shortlist ·{" "}
                          {trip.selectedPlaceIds.includes(member.placeId)
                            ? "Chosen for day"
                            : "Not chosen for day"}{" "}
                          ·{" "}
                          {day
                            ? day.includedIds.includes(member.placeId)
                              ? "Included in saved day"
                              : "Not included in saved day"
                            : "Day status loading"}
                          {day?.needsReview ? " — day needs review" : ""}
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              mutate({
                                action: "remove",
                                placeId: member.placeId,
                              }),
                            )
                          }
                        >
                          Remove{" "}
                          {member.place.branch ?? member.place.displayName}
                        </button>
                        <VisitFacts facts={member.visitFacts} />
                        <details>
                          <summary>Saved sources and branch evidence</summary>
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
                              key={`${evidence.importId}:${evidence.mentionId}`}
                              className="import-attribution"
                            >
                              <ImportedEvidence
                                evidence={{
                                  source: evidence.source,
                                  extraction: evidence.extraction,
                                  confirmation: evidence.confirmation,
                                }}
                              />
                            </div>
                          ))}
                        </details>
                      </article>
                    ))}
                  </section>
                ),
                day: (
                  <DayPlanInputs
                    key={`day:${trip.id}:${trip.dataKind}`}
                    trip={trip}
                    onWorkspaceDay={reportDay}
                    onActivity={setDayActivity}
                    onTripReload={() => load()}
                    onDenied={() => {
                      void load();
                    }}
                  />
                ),
                group: (
                  <CollaborationPanel
                    key={`decisions:${trip.id}:${trip.dataKind}`}
                    tripId={trip.id}
                    dataKind={trip.dataKind}
                    selectedPlaceIds={trip.selectedPlaceIds}
                    places={trip.savedPlaces.map((member) => member.place)}
                    owner
                    onActivity={setGroupActivity}
                    onPendingSuggestions={setSuggestions}
                    onTripChanged={() => load()}
                    onDenied={() => {
                      void load();
                    }}
                  />
                ),
              }}
            </TripWorkspace>
          )}
        </>
      )}
    </section>
  );
}
