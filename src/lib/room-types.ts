import type { Day, Stop } from "./plan.ts";

export const VOTES = ["must", "interested", "skip"] as const;
export type Vote = (typeof VOTES)[number];

export const VOTE_LABEL: Record<Vote, string> = {
  must: "Must go",
  interested: "Interested",
  skip: "Skip",
};

/** Group score = 2 × Must go + 1 × Interested − 1 × Skip. */
export const VOTE_WEIGHT: Record<Vote, number> = {
  must: 2,
  interested: 1,
  skip: -1,
};

export const MAX_PARTICIPANTS = 30;
export const MAX_NAME = 40;
export const ROOM_TTL_SECONDS = 30 * 24 * 3600;

export type Tally = {
  must: string[];
  interested: string[];
  skip: string[];
  score: number;
};

export type Participant = {
  name: string;
  votes: Record<string, Vote>;
};

export type RoomView = {
  id: string;
  destination?: string;
  /** Days in order; every day has at least one stop. */
  days: Day[];
  /** All stops across all days, in order (convenience for tallies). */
  stops: Stop[];
  closed: boolean;
  createdAt: number;
  participants: Participant[];
  tallies: Record<string, Tally>;
  /** Present when the caller proved who they are with their participant id. */
  you?: Participant;
  isOwner: boolean;
};

/** Random URL-safe identifier (room ids, owner keys, participant ids). */
export function isToken(value: unknown, min = 16, max = 64): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function isVote(value: unknown): value is Vote {
  return (
    typeof value === "string" && (VOTES as readonly string[]).includes(value)
  );
}

/** Trims and strips control characters; null when empty or too long. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .replace(/[\p{Cc}\p{Cf}<>]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_NAME ? name : null;
}

export type PersonRecord = { key: string; name: string; joined: number };

/**
 * Names must be unique on screen: the second "Sam" becomes "Sam (2)".
 * Earlier joiners keep the plain name.
 */
export function displayNames(people: PersonRecord[]): Map<string, string> {
  const sorted = [...people].sort(
    (a, b) => a.joined - b.joined || a.key.localeCompare(b.key),
  );
  const seen = new Map<string, number>();
  const result = new Map<string, string>();
  for (const person of sorted) {
    const lower = person.name.toLowerCase();
    const count = (seen.get(lower) ?? 0) + 1;
    seen.set(lower, count);
    result.set(
      person.key,
      count === 1 ? person.name : `${person.name} (${count})`,
    );
  }
  return result;
}

/** Counts votes per stop. Votes for stops no longer in the plan are ignored. */
export function computeTallies(
  stops: Pick<Stop, "id">[],
  people: PersonRecord[],
  votes: Record<string, Vote>,
): { participants: Participant[]; tallies: Record<string, Tally> } {
  const names = displayNames(people);
  const order = [...people].sort(
    (a, b) => a.joined - b.joined || a.key.localeCompare(b.key),
  );
  const stopIds = new Set(stops.map((s) => s.id));
  const tallies: Record<string, Tally> = {};
  for (const stop of stops) {
    tallies[stop.id] = { must: [], interested: [], skip: [], score: 0 };
  }
  const participants: Participant[] = [];
  for (const person of order) {
    const name = names.get(person.key) ?? person.name;
    const own: Record<string, Vote> = {};
    for (const stopId of stopIds) {
      const vote = votes[`${person.key}|${stopId}`];
      if (!isVote(vote)) continue;
      own[stopId] = vote;
      tallies[stopId][vote].push(name);
      tallies[stopId].score += VOTE_WEIGHT[vote];
    }
    participants.push({ name, votes: own });
  }
  return { participants, tallies };
}

/** Stops ordered by group score (ties keep the plan's order). */
export function rankStops(
  stops: Stop[],
  tallies: Record<string, Tally>,
): Stop[] {
  return stops
    .map((stop, index) => ({
      stop,
      index,
      score: tallies[stop.id]?.score ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.stop);
}

/** Re-ranks the stops inside each day by group score; day order is unchanged. */
export function rankWithinDays(
  days: Day[],
  tallies: Record<string, Tally>,
): Day[] {
  return days.map((day) => ({ ...day, stops: rankStops(day.stops, tallies) }));
}
