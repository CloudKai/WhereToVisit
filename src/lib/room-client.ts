import { isToken, type RoomView, type Vote } from "./room-types.ts";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const OWNER = (id: string) => `wtv.owner.${id}`;
const ME = (id: string) => `wtv.me.${id}`;
const CURRENT = "wtv.room.current";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the feature still works for this page view.
  }
}

export function randomId(bytes = 16): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function getOwnerKey(id: string): string | undefined {
  const value = read(OWNER(id));
  return isToken(value, 16, 96) ? value : undefined;
}

export function saveOwnerKey(id: string, key: string) {
  write(OWNER(id), key);
}

export function getCurrentRoom(): string | undefined {
  const value = read(CURRENT);
  return isToken(value, 16, 64) ? value : undefined;
}

export function setCurrentRoom(id: string | null) {
  write(CURRENT, id);
}

export type Me = { pid: string; name: string };

export function getMe(id: string): Me | undefined {
  try {
    const parsed = JSON.parse(read(ME(id)) ?? "null") as Partial<Me> | null;
    if (parsed && isToken(parsed.pid) && typeof parsed.name === "string") {
      return { pid: parsed.pid, name: parsed.name };
    }
  } catch {
    // ignore damaged storage
  }
  return undefined;
}

export function saveMe(id: string, me: Me) {
  write(ME(id), JSON.stringify(me));
}

/** Reads `#k=<owner key>` from a link, if present. */
export function ownerKeyFromHash(hash: string): string | undefined {
  const match = /^#k=([A-Za-z0-9_-]{16,96})$/.exec(hash);
  return match?.[1];
}

async function call<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Can’t reach the server. Check your connection.");
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // non-JSON error page
  }
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new ApiError(response.status, message ?? "Something went wrong.");
  }
  return data as T;
}

function identity(opts: {
  pid?: string;
  ownerKey?: string;
}): Record<string, string> {
  return {
    ...(opts.pid ? { "x-participant-id": opts.pid } : {}),
    ...(opts.ownerKey ? { "x-owner-key": opts.ownerKey } : {}),
  };
}

export const roomApi = {
  create: (token: string) =>
    call<{ id: string; ownerKey: string }>("/api/rooms", {
      method: "POST",
      body: { token },
    }),
  get: (id: string, opts: { pid?: string; ownerKey?: string }) =>
    call<RoomView>(`/api/rooms/${id}`, { headers: identity(opts) }),
  vote: (
    id: string,
    input: { pid: string; name: string; stopId: string; vote: Vote | null },
    ownerKey?: string,
  ) =>
    call<RoomView>(`/api/rooms/${id}/votes`, {
      method: "POST",
      body: {
        participantId: input.pid,
        name: input.name,
        stopId: input.stopId,
        vote: input.vote,
      },
      headers: identity({ ownerKey }),
    }),
  updateStops: (id: string, ownerKey: string, token: string) =>
    call<RoomView>(`/api/rooms/${id}`, {
      method: "PUT",
      body: { token },
      headers: identity({ ownerKey }),
    }),
  setClosed: (id: string, ownerKey: string, closed: boolean) =>
    call<RoomView>(`/api/rooms/${id}`, {
      method: "PATCH",
      body: { closed },
      headers: identity({ ownerKey }),
    }),
  remove: (id: string, ownerKey: string) =>
    call<{ deleted: boolean }>(`/api/rooms/${id}`, {
      method: "DELETE",
      headers: identity({ ownerKey }),
    }),
};
