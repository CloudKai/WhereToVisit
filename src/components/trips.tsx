"use client";
import { useEffect, useRef, useState } from "react";
import type { Trip, TripSaveIntent } from "@/shared/contracts";
import { CollaborationPanel } from "./collaboration";
import { DayPlanInputs } from "./day-plan";
import { ImportedEvidence } from "./imported-evidence";
import { InvitationControls } from "./invitations";

type Identity = { id: string; email: string };
export function TripDashboard({
  placeId,
  importId,
}: {
  placeId?: string;
  importId?: string;
}) {
  const [user, setUser] = useState<Identity | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState("");
  const [intent, setIntent] = useState<TripSaveIntent | null>(null);
  const [intentId, setIntentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [editTitle, setEditTitle] = useState("");
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
  ) {
    const current = isCurrent ?? (() => true);
    // A route bootstrap replaces its cancelled predecessor even while busy.
    // User actions remain serialized by the current busy state.
    if ((busy && !isCurrent) || !current()) return;
    setBusy(true);
    setError("");
    setNotice("");
    retry.current = operation;
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
      setIntent(null);
      return;
    }
    const value = await response.json();
    if (!isCurrent()) return;
    if (!response.ok)
      throw new Error(value.error?.message ?? "Trips are unavailable.");
    setUser(value.user);
    setTrips(value.trips);
    setTripId((current) =>
      value.trips.some((item: Trip) => item.id === current)
        ? current
        : (value.trips[0]?.id ?? ""),
    );
    if (pendingId) {
      const pending = await json(`/api/trip-save-intents/${pendingId}`);
      if (isCurrent()) setIntent(pending.intent);
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial request helpers intentionally use the route values only.
  useEffect(() => {
    let active = true;
    void run(
      async () => {
        let pending = "";
        if (placeId) {
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
            if (active) setIntentId(pending);
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
        if (active) await load(pending, () => active);
      },
      () => active,
    );
    return () => {
      active = false;
    };
  }, [placeId, importId]);
  const trip = trips.find((item) => item.id === tripId);
  useEffect(() => {
    setEditTitle(trip?.title ?? "");
  }, [trip?.title]);
  async function mutate(data: unknown) {
    const value = await json(`/api/trips/${tripId}`, data);
    setTrips((current) =>
      current.map((item) => (item.id === value.trip.id ? value.trip : item)),
    );
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
        <>
          <h2>Sign in to save</h2>
          <p>
            Browsing stays available without an account. A save requires your
            explicit review after sign-in.
          </p>
          <p>
            Local email/password accounts. Email verification and password
            recovery are not available yet.
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
                await json(
                  `/api/auth/${register ? "sign-up" : "sign-in"}/email`,
                  {
                    email,
                    password,
                    ...(register ? { name: "Trip organiser" } : {}),
                  },
                );
                setPassword("");
                await load();
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
        </>
      )}
      {user && (
        <>
          <p>
            Signed in as <strong>{user.email}</strong>. Your Trips are private.
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
          {intent && (
            <section aria-label="Pending save" className="import-job">
              <h2>Review your pending save</h2>
              <p>
                {intent.place.displayName} · {intent.place.branch}
              </p>
              <p>{intent.place.address}</p>
              <p>
                Save to the selected Shanghai Trip as {user.email}.{" "}
                {intent.importedEvidence.length} original source mentions will
                be retained.
              </p>
              {intent.dataKind === "fixture" && (
                <p className="fixture-notice">
                  Fictional scenario branch — not a real venue.
                </p>
              )}
              <button
                disabled={busy || !trip}
                type="button"
                onClick={() =>
                  void run(async () => {
                    await mutate({ action: "save", intentId });
                    setIntent(null);
                    setNotice("Reviewed branch saved to your Trip.");
                  })
                }
              >
                Save reviewed branch
              </button>
            </section>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const value = await json("/api/trips", {
                  title,
                  city: "Shanghai",
                });
                setTrips((current) => [value.trip, ...current]);
                setTripId(value.trip.id);
                setTitle("");
                setNotice("Private Trip created.");
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
                onChange={(event) => setTripId(event.target.value)}
              >
                {trips.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </>
          )}
          {trip && (
            <>
              <section aria-label="Saved shortlist" className="import-job">
                <h2>{trip.title}</h2>
                <p>
                  {trip.city} · {trip.selectedPlaceIds.length} selected for a
                  future day plan
                </p>
                {trip.dataKind === "fixture" && (
                  <p className="fixture-notice">
                    Fictional scenario collection — application behaviour only.
                  </p>
                )}
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
                />
                {!trip.savedPlaces.length && (
                  <p>
                    No saved Places yet. Browse discovery or confirm an imported
                    branch.
                  </p>
                )}
                {trip.savedPlaces.map((member) => (
                  <article className="import-candidate" key={member.placeId}>
                    <h3>{member.place.displayName}</h3>
                    <p>
                      {member.place.branch} · {member.place.address}
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={trip.selectedPlaceIds.includes(member.placeId)}
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
                      Select {member.place.branch ?? member.place.displayName}{" "}
                      for a day plan
                    </label>
                    <p>
                      Selection is separate from saving. Save one-day inputs
                      below to generate a grounded order; real timings remain
                      unresolved.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          mutate({ action: "remove", placeId: member.placeId }),
                        )
                      }
                    >
                      Remove {member.place.branch ?? member.place.displayName}
                    </button>
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
              <DayPlanInputs
                key={`day:${trip.id}:${trip.dataKind}`}
                trip={trip}
                onTripReload={() => load()}
                onDenied={() => {
                  void load();
                }}
              />
              <CollaborationPanel
                key={`decisions:${trip.id}:${trip.dataKind}`}
                tripId={trip.id}
                dataKind={trip.dataKind}
                places={trip.savedPlaces.map((member) => member.place)}
                owner
                onTripChanged={() => load()}
                onDenied={() => {
                  void load();
                }}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
