import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decodePlan, type Stop } from "./plan.ts";
import {
  cleanName,
  computeTallies,
  isToken,
  isVote,
  MAX_PARTICIPANTS,
  type PersonRecord,
  ROOM_TTL_SECONDS,
  type RoomView,
  type Vote,
} from "./room-types.ts";
import type { Store } from "./store.ts";

export class RoomError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RoomError";
    this.status = status;
  }
}

type RoomMeta = {
  v: 1;
  destination?: string;
  stops: Stop[];
  createdAt: number;
  ownerHash: string;
  closed: boolean;
};

const metaKey = (id: string) => `wtv:room:${id}`;
const peopleKey = (id: string) => `wtv:room:${id}:people`;
const votesKey = (id: string) => `wtv:room:${id}:votes`;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stored identity of a participant; the raw id never reaches storage. */
export function participantKey(participantId: string): string {
  return sha256(`participant:${participantId}`).slice(0, 32);
}

function newToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function sameSecret(secret: string, expectedHash: string): boolean {
  const a = Buffer.from(sha256(`owner:${secret}`), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadMeta(store: Store, id: string): Promise<RoomMeta> {
  if (!isToken(id, 16, 64)) throw new RoomError(404, "Room not found");
  const raw = await store.get(metaKey(id));
  if (!raw)
    throw new RoomError(404, "This voting link has expired or doesn’t exist.");
  try {
    const meta = JSON.parse(raw) as RoomMeta;
    if (meta.v !== 1 || !Array.isArray(meta.stops)) throw new Error("bad meta");
    return meta;
  } catch {
    throw new RoomError(500, "This room’s data is damaged.");
  }
}

function requireOwner(meta: RoomMeta, ownerKey: string | undefined) {
  if (
    !ownerKey ||
    !isToken(ownerKey, 16, 96) ||
    !sameSecret(ownerKey, meta.ownerHash)
  ) {
    throw new RoomError(403, "Only the organiser can do that.");
  }
}

function stopsFromToken(token: unknown): {
  stops: Stop[];
  destination?: string;
} {
  const plan = typeof token === "string" ? decodePlan(token) : null;
  if (!plan || plan.stops.length === 0) {
    throw new RoomError(400, "Add at least one stop to your day first.");
  }
  return { stops: plan.stops, destination: plan.destination };
}

export async function createRoom(
  store: Store,
  planToken: unknown,
): Promise<{ id: string; ownerKey: string }> {
  const { stops, destination } = stopsFromToken(planToken);
  const id = newToken(16);
  const ownerKey = newToken(24);
  const meta: RoomMeta = {
    v: 1,
    ...(destination ? { destination } : {}),
    stops,
    createdAt: Date.now(),
    ownerHash: sha256(`owner:${ownerKey}`),
    closed: false,
  };
  const created = await store.setIfAbsent(
    metaKey(id),
    JSON.stringify(meta),
    ROOM_TTL_SECONDS,
  );
  if (!created)
    throw new RoomError(500, "Couldn’t create the room. Try again.");
  return { id, ownerKey };
}

export async function getRoom(
  store: Store,
  id: string,
  caller: { participantId?: string; ownerKey?: string } = {},
): Promise<RoomView> {
  const meta = await loadMeta(store, id);
  const [peopleRaw, votesRaw] = await Promise.all([
    store.hgetall(peopleKey(id)),
    store.hgetall(votesKey(id)),
  ]);

  const people: PersonRecord[] = [];
  for (const [key, json] of Object.entries(peopleRaw)) {
    try {
      const parsed = JSON.parse(json) as { name?: unknown; joined?: unknown };
      const name = cleanName(parsed.name);
      if (name && typeof parsed.joined === "number") {
        people.push({ key, name, joined: parsed.joined });
      }
    } catch {
      // Skip a damaged record rather than failing the whole room.
    }
  }
  const votes: Record<string, Vote> = {};
  for (const [field, value] of Object.entries(votesRaw)) {
    if (isVote(value)) votes[field] = value;
  }

  const { participants, tallies } = computeTallies(meta.stops, people, votes);
  const view: RoomView = {
    id,
    destination: meta.destination,
    stops: meta.stops,
    closed: meta.closed,
    createdAt: meta.createdAt,
    participants,
    tallies,
    isOwner: Boolean(
      caller.ownerKey &&
      isToken(caller.ownerKey, 16, 96) &&
      sameSecret(caller.ownerKey, meta.ownerHash),
    ),
  };

  if (caller.participantId && isToken(caller.participantId)) {
    const key = participantKey(caller.participantId);
    const index = people
      .slice()
      .sort((a, b) => a.joined - b.joined || a.key.localeCompare(b.key))
      .findIndex((p) => p.key === key);
    if (index >= 0) view.you = participants[index];
  }
  return view;
}

export async function castVote(
  store: Store,
  id: string,
  input: {
    participantId: unknown;
    name: unknown;
    stopId: unknown;
    vote: unknown;
  },
): Promise<void> {
  const meta = await loadMeta(store, id);
  if (meta.closed) throw new RoomError(409, "Voting is closed for this plan.");
  if (!isToken(input.participantId))
    throw new RoomError(400, "Invalid participant");
  const name = cleanName(input.name);
  if (!name) throw new RoomError(400, "Enter a name (1–40 characters).");
  if (
    typeof input.stopId !== "string" ||
    !meta.stops.some((s) => s.id === input.stopId)
  ) {
    throw new RoomError(400, "That place isn’t in this plan.");
  }
  if (input.vote !== null && !isVote(input.vote))
    throw new RoomError(400, "Invalid vote");

  const key = participantKey(input.participantId);
  const people = peopleKey(id);
  const existing = (await store.hgetall(people))[key];
  let joined = Date.now();
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { joined?: unknown };
      if (typeof parsed.joined === "number") joined = parsed.joined;
    } catch {
      // Treat a damaged record as a fresh join.
    }
  } else if ((await store.hlen(people)) >= MAX_PARTICIPANTS) {
    throw new RoomError(
      409,
      `This plan already has ${MAX_PARTICIPANTS} voters.`,
    );
  }
  await store.hset(
    people,
    key,
    JSON.stringify({ name, joined }),
    ROOM_TTL_SECONDS,
  );

  const field = `${key}|${input.stopId}`;
  if (input.vote === null) {
    await store.hdel(votesKey(id), field);
  } else {
    await store.hset(votesKey(id), field, input.vote, ROOM_TTL_SECONDS);
  }
  await store.expire([metaKey(id)], ROOM_TTL_SECONDS);
}

export async function updateStops(
  store: Store,
  id: string,
  ownerKey: string | undefined,
  planToken: unknown,
): Promise<void> {
  const meta = await loadMeta(store, id);
  requireOwner(meta, ownerKey);
  const { stops, destination } = stopsFromToken(planToken);
  const next: RoomMeta = {
    ...meta,
    stops,
    ...(destination ? { destination } : {}),
  };
  await store.set(metaKey(id), JSON.stringify(next), ROOM_TTL_SECONDS);

  // Drop votes for places that were removed from the plan.
  const keep = new Set(stops.map((s) => s.id));
  const votes = await store.hgetall(votesKey(id));
  for (const field of Object.keys(votes)) {
    const stopId = field.slice(field.indexOf("|") + 1);
    if (!keep.has(stopId)) await store.hdel(votesKey(id), field);
  }
}

export async function setClosed(
  store: Store,
  id: string,
  ownerKey: string | undefined,
  closed: boolean,
): Promise<void> {
  const meta = await loadMeta(store, id);
  requireOwner(meta, ownerKey);
  await store.set(
    metaKey(id),
    JSON.stringify({ ...meta, closed }),
    ROOM_TTL_SECONDS,
  );
}

export async function deleteRoom(
  store: Store,
  id: string,
  ownerKey: string | undefined,
): Promise<void> {
  const meta = await loadMeta(store, id);
  requireOwner(meta, ownerKey);
  await store.del([metaKey(id), peopleKey(id), votesKey(id)]);
}

/** Fixed-window limiter backed by the shared store, keyed by a hashed client id. */
export async function allow(
  store: Store,
  bucket: string,
  client: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const key = `wtv:rl:${bucket}:${sha256(`client:${client}`).slice(0, 24)}`;
  return (await store.incr(key, windowSeconds)) <= limit;
}
