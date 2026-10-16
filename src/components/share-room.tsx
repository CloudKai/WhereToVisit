"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { encodePlan } from "@/lib/plan";
import {
  ApiError,
  getCurrentRoom,
  getOwnerKey,
  roomApi,
  saveOwnerKey,
  setCurrentRoom,
} from "@/lib/room-client";
import { usePlan } from "./plan-provider";

type Created = { id: string; ownerKey: string };

/** "Vote with friends" panel on the day-plan page. */
export function ShareRoom() {
  const { plan, hydrated } = usePlan();
  const [room, setRoom] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  }>();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"friend" | "organiser" | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const id = getCurrentRoom();
    const ownerKey = id ? getOwnerKey(id) : undefined;
    if (id && ownerKey) setRoom({ id, ownerKey });
  }, []);

  if (!hydrated || plan.stops.length === 0) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setCurrentRoom(null);
        setRoom(null);
        setMessage({
          kind: "error",
          text: "That voting link has expired. Create a new one.",
        });
      } else {
        setMessage({
          kind: "error",
          text:
            error instanceof Error ? error.message : "Something went wrong.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      const created = await roomApi.create(encodePlan(plan));
      saveOwnerKey(created.id, created.ownerKey);
      setCurrentRoom(created.id);
      setRoom(created);
      setMessage({ kind: "ok", text: "Voting link created." });
    });

  const update = () =>
    run(async () => {
      if (!room) return;
      await roomApi.updateStops(room.id, room.ownerKey, encodePlan(plan));
      setMessage({
        kind: "ok",
        text: "Shared stops updated. Votes for removed places were cleared.",
      });
    });

  async function copy(text: string, which: "friend" | "organiser") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied(null);
      setMessage({
        kind: "error",
        text: "Couldn’t copy automatically — select the link and copy it.",
      });
    }
  }

  const friendLink = room ? `${origin}/r/${room.id}` : "";
  const organiserLink = room ? `${origin}/r/${room.id}#k=${room.ownerKey}` : "";

  return (
    <section className="share vote-share" aria-labelledby="vote-heading">
      <h2 id="vote-heading">Vote on it with friends</h2>
      {!room ? (
        <>
          <p className="hint">
            Get a link for your companions. They enter a name — no sign-up — and
            vote <strong>Must go</strong>, <strong>Interested</strong> or{" "}
            <strong>Skip</strong> on each stop. You see the group’s ranking.
          </p>
          <button
            type="button"
            className="button"
            onClick={create}
            disabled={busy}
          >
            {busy ? "Creating…" : "Create voting link"}
          </button>
        </>
      ) : (
        <>
          <label className="field-label" htmlFor="friend-link">
            Send this to your companions
          </label>
          <div className="share-row">
            <input
              id="friend-link"
              type="text"
              readOnly
              value={friendLink}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="button"
              onClick={() => copy(friendLink, "friend")}
            >
              {copied === "friend" ? "Copied" : "Copy"}
            </button>
          </div>
          <label className="field-label" htmlFor="organiser-link">
            Your organiser link — keep this private
          </label>
          <div className="share-row">
            <input
              id="organiser-link"
              type="text"
              readOnly
              value={organiserLink}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="button secondary"
              onClick={() => copy(organiserLink, "organiser")}
            >
              {copied === "organiser" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="hint">
            The organiser link lets you close voting or delete the room from
            another device. This browser already remembers it.
          </p>
          <div className="share-row actions">
            <Link className="button" href={`/r/${room.id}`}>
              See votes
            </Link>
            <button
              type="button"
              className="button secondary"
              onClick={update}
              disabled={busy}
            >
              {busy ? "Updating…" : "Update shared stops from this plan"}
            </button>
          </div>
        </>
      )}
      <p className="hint">
        Anyone with the friend link can vote, so share it only with people you
        trust. Names aren’t verified. Voting links expire after 30 days of
        inactivity.
      </p>
      {message && (
        <p
          className={message.kind === "error" ? "notice" : "hint"}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
