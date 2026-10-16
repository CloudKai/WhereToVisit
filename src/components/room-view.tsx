"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Plan, encodePlan } from "@/lib/plan";
import {
  ApiError,
  getMe,
  getOwnerKey,
  type Me,
  ownerKeyFromHash,
  randomId,
  roomApi,
  saveMe,
  saveOwnerKey,
  setCurrentRoom,
} from "@/lib/room-client";
import {
  cleanName,
  isToken,
  rankStops,
  type RoomView as RoomData,
  VOTE_LABEL,
  VOTES,
  type Vote,
} from "@/lib/room-types";
import { type MapMarker, MapCanvas } from "./map";
import { usePlan } from "./plan-provider";

const POLL_MS = 15000;

type Overlay = Record<string, Vote | null>;

export function RoomView({ id }: { id: string }) {
  const router = useRouter();
  const { plan, replace } = usePlan();
  const [room, setRoom] = useState<RoomData>();
  const [error, setError] = useState<{ status: number; text: string }>();
  const [notice, setNotice] = useState<string>();
  const [me, setMe] = useState<Me>();
  const [ownerKey, setOwnerKey] = useState<string>();
  const [nameDraft, setNameDraft] = useState("");
  const [overlay, setOverlay] = useState<Overlay>({});
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const pending = useRef(0);
  const ready = useRef(false);
  const hasRoom = useRef(false);

  // Learn who we are: a saved name/id, and the organiser key if the link has one.
  useEffect(() => {
    if (!isToken(id, 16, 64)) {
      setError({ status: 404, text: "This voting link isn’t valid." });
      return;
    }
    const fromHash = ownerKeyFromHash(window.location.hash);
    if (fromHash) {
      saveOwnerKey(id, fromHash);
      setCurrentRoom(id);
      // Remove the secret from the address bar so it isn't copied by accident.
      window.history.replaceState(null, "", `/r/${id}`);
    }
    setOwnerKey(fromHash ?? getOwnerKey(id));
    const saved = getMe(id);
    setMe(saved);
    setNameDraft(saved?.name ?? "");
    ready.current = true;
  }, [id]);

  const load = useCallback(async () => {
    if (!ready.current) return;
    try {
      const data = await roomApi.get(id, {
        pid: getMe(id)?.pid,
        ownerKey: getOwnerKey(id),
      });
      // Don't overwrite what the user just did with an older response.
      if (pending.current === 0) {
        hasRoom.current = true;
        setRoom(data);
        setOverlay({});
      }
      setError(undefined);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 404 || status === 503) {
        setError({
          status,
          text: e instanceof Error ? e.message : "Unavailable",
        });
      } else if (!hasRoom.current) {
        setError({
          status,
          text: e instanceof Error ? e.message : "Couldn’t load.",
        });
      }
    }
  }, [id]);

  useEffect(() => {
    if (!isToken(id, 16, 64)) return;
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () =>
      document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, load]);

  function saveName(event: React.FormEvent) {
    event.preventDefault();
    const name = cleanName(nameDraft);
    if (!name) {
      setNotice("Enter a name between 1 and 40 characters.");
      return;
    }
    const next: Me = { pid: me?.pid ?? randomId(), name };
    saveMe(id, next);
    setMe(next);
    setEditingName(false);
    setNotice(undefined);
  }

  async function castVote(stopId: string, vote: Vote | null) {
    if (!me || !room) return;
    setNotice(undefined);
    pending.current += 1;
    setOverlay((o) => ({ ...o, [stopId]: vote }));
    try {
      const data = await roomApi.vote(
        id,
        { pid: me.pid, name: me.name, stopId, vote },
        ownerKey,
      );
      if (pending.current === 1) {
        hasRoom.current = true;
        setRoom(data);
        setOverlay({});
      }
    } catch (e) {
      setOverlay((o) => {
        const { [stopId]: _discard, ...rest } = o;
        return rest;
      });
      setNotice(
        e instanceof Error ? e.message : "Your vote wasn’t saved. Try again.",
      );
    } finally {
      pending.current -= 1;
      if (pending.current === 0) void load();
    }
  }

  async function organiser(
    action: () => Promise<RoomData | void>,
    success: string,
  ) {
    setBusy(true);
    setNotice(undefined);
    try {
      const data = await action();
      if (data) setRoom(data);
      setNotice(success);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  }

  const stops = room?.stops ?? [];
  const myVotes = useMemo(() => {
    const merged: Record<string, Vote | null | undefined> = {
      ...room?.you?.votes,
    };
    for (const [stopId, vote] of Object.entries(overlay)) merged[stopId] = vote;
    return merged;
  }, [room?.you?.votes, overlay]);
  const ranked = useMemo(
    () => (room ? rankStops(room.stops, room.tallies) : []),
    [room],
  );
  const markers: MapMarker[] = stops.map((s, i) => ({
    id: s.id,
    lat: s.lat,
    lon: s.lon,
    label: `${i + 1}. ${s.name}`,
    kind: "stop",
    badge: String(i + 1),
  }));

  function copyToMyDay(order: typeof stops) {
    const next: Plan = { destination: room?.destination, stops: order };
    replace(next);
    router.push("/plan");
  }

  if (error && !room) {
    return (
      <section className="page-section problem" role="alert">
        <h1>
          {error.status === 404
            ? "This link has expired"
            : "Voting isn’t available"}
        </h1>
        <p>{error.text}</p>
        {error.status === 404 && (
          <p>Ask the organiser to create a new voting link.</p>
        )}
      </section>
    );
  }
  if (!room) {
    return (
      <div className="page-section" aria-busy="true">
        <p className="eyebrow" role="status">
          Loading the plan…
        </p>
      </div>
    );
  }

  const planDiffers =
    encodePlan(plan) !== encodePlan({ destination: room.destination, stops });

  return (
    <div className="page-section room">
      <header className="explore-head">
        <p className="eyebrow">
          Group plan{room.destination ? ` · ${room.destination}` : ""}
        </p>
        <h1>Vote on the plan</h1>
        <p className="lead">
          {room.participants.length === 0
            ? "Nobody has voted yet."
            : `${room.participants.length} ${room.participants.length === 1 ? "person has" : "people have"} voted.`}{" "}
          Tap Must go, Interested or Skip on each place.
        </p>
        {room.closed && (
          <p className="notice" role="status">
            Voting is closed. You can still see the results.
          </p>
        )}
      </header>

      {!me || editingName ? (
        <form className="name-form" onSubmit={saveName}>
          <label htmlFor="voter-name">Your name</label>
          <div className="share-row">
            <input
              id="voter-name"
              type="text"
              value={nameDraft}
              maxLength={40}
              autoComplete="nickname"
              placeholder="So friends see who voted what"
              onChange={(event) => setNameDraft(event.target.value)}
            />
            <button type="submit" className="button">
              {me ? "Save name" : "Start voting"}
            </button>
          </div>
          <p className="hint">
            No account needed. Your name is shown to everyone with this link and
            isn’t verified.
          </p>
        </form>
      ) : (
        <p className="hint">
          Voting as <strong>{me.name}</strong>.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setNameDraft(me.name);
              setEditingName(true);
            }}
          >
            Change name
          </button>
        </p>
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="plan-layout">
        <div className="plan-map">
          <MapCanvas
            markers={markers}
            label="Map of the plan"
            selectedId={selected}
            onSelect={setSelected}
          />
        </div>

        <div className="plan-list">
          <ol className="itinerary vote-list">
            {stops.map((stop, index) => {
              const tally = room.tallies[stop.id];
              const mine = myVotes[stop.id] ?? null;
              const count =
                (tally?.must.length ?? 0) +
                (tally?.interested.length ?? 0) +
                (tally?.skip.length ?? 0);
              return (
                <li key={stop.id}>
                  <article
                    className={selected === stop.id ? "stop selected" : "stop"}
                  >
                    <button
                      type="button"
                      className="stop-number"
                      onClick={() => setSelected(stop.id)}
                      aria-pressed={selected === stop.id}
                      aria-label={`Show ${stop.name} on the map`}
                    >
                      {index + 1}
                    </button>
                    <div className="stop-main">
                      <h3>{stop.name}</h3>
                      <p className="hint">
                        {stop.category === "cafe" ? "Café" : "Restaurant"}
                        {stop.address ? ` · ${stop.address}` : ""}
                      </p>
                      <div
                        className="vote-buttons"
                        role="group"
                        aria-label={`Your vote for ${stop.name}`}
                      >
                        {VOTES.map((vote) => (
                          <button
                            key={vote}
                            type="button"
                            className={`vote vote-${vote}${mine === vote ? " chosen" : ""}`}
                            aria-pressed={mine === vote}
                            disabled={!me || room.closed}
                            onClick={() =>
                              castVote(stop.id, mine === vote ? null : vote)
                            }
                          >
                            {VOTE_LABEL[vote]}
                          </button>
                        ))}
                      </div>
                      {!me && !room.closed && (
                        <p className="hint">Enter your name above to vote.</p>
                      )}
                      <p className="tally">
                        <span className="t-must">
                          {tally?.must.length ?? 0} Must go
                        </span>
                        <span className="t-interested">
                          {tally?.interested.length ?? 0} Interested
                        </span>
                        <span className="t-skip">
                          {tally?.skip.length ?? 0} Skip
                        </span>
                      </p>
                      {count > 0 && (
                        <details className="more">
                          <summary>Who voted</summary>
                          <ul className="voters">
                            {VOTES.filter(
                              (v) => (tally?.[v].length ?? 0) > 0,
                            ).map((v) => (
                              <li key={v}>
                                <strong>{VOTE_LABEL[v]}:</strong>{" "}
                                {tally?.[v].join(", ")}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>

          <section className="share" aria-labelledby="rank-heading">
            <h2 id="rank-heading">Group ranking</h2>
            <p className="hint">
              Score = 2 × Must go + 1 × Interested − 1 × Skip.
            </p>
            <ol className="ranking">
              {ranked.map((stop) => (
                <li key={stop.id}>
                  <span>{stop.name}</span>
                  <strong>{room.tallies[stop.id]?.score ?? 0}</strong>
                </li>
              ))}
            </ol>
            <div className="share-row actions">
              <button
                type="button"
                className="button"
                onClick={() => copyToMyDay(ranked)}
              >
                Plan a route in this order
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => copyToMyDay(stops)}
              >
                Plan in the original order
              </button>
            </div>
            <p className="hint">
              This copies the stops into your own “Your day” page, where you can
              add travel times. Your choice doesn’t change anyone else’s plan.
            </p>
          </section>

          {room.isOwner && ownerKey && (
            <section className="share" aria-labelledby="owner-heading">
              <h2 id="owner-heading">Organiser controls</h2>
              <div className="share-row actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || plan.stops.length === 0 || !planDiffers}
                  onClick={() =>
                    organiser(
                      () => roomApi.updateStops(id, ownerKey, encodePlan(plan)),
                      "Stops updated from your current plan. Votes for removed places were cleared.",
                    )
                  }
                  title={
                    plan.stops.length === 0
                      ? "Your day is empty in this browser"
                      : !planDiffers
                        ? "Your day already matches"
                        : undefined
                  }
                >
                  Update stops from my day
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    organiser(
                      () => roomApi.setClosed(id, ownerKey, !room.closed),
                      room.closed ? "Voting reopened." : "Voting closed.",
                    )
                  }
                >
                  {room.closed ? "Reopen voting" : "Close voting"}
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Delete this voting room and all votes? This can’t be undone.",
                      )
                    )
                      return;
                    try {
                      await roomApi.remove(id, ownerKey);
                      setCurrentRoom(null);
                      router.push("/plan");
                    } catch (e) {
                      setNotice(
                        e instanceof Error ? e.message : "Couldn’t delete.",
                      );
                    }
                  }}
                >
                  Delete room
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      <p className="hint">
        Anyone with this link can see these votes and the names shown. Voting
        links expire after 30 days of inactivity.
      </p>
    </div>
  );
}
