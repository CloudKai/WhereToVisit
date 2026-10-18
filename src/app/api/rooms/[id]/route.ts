import {
  handleError,
  json,
  limit,
  readJson,
  requireStore,
} from "@/lib/room-http";
import { deleteRoom, getRoom, setClosed, updateStops } from "@/lib/rooms";

type Context = { params: Promise<{ id: string }> };

function secrets(request: Request) {
  return {
    ownerKey: request.headers.get("x-owner-key") ?? undefined,
    participantId: request.headers.get("x-participant-id") ?? undefined,
  };
}

export async function GET(request: Request, { params }: Context) {
  const found = requireStore();
  if (found.response) return found.response;
  const store = found.store;
  try {
    const limited = await limit(store, request, "read", 240, 60);
    if (limited) return limited;
    return json(await getRoom(store, (await params).id, secrets(request)));
  } catch (error) {
    return handleError(error);
  }
}

/** Organiser: replace the stops with the current plan. */
export async function PUT(request: Request, { params }: Context) {
  const found = requireStore();
  if (found.response) return found.response;
  const store = found.store;
  try {
    const limited = await limit(store, request, "write", 60, 60);
    if (limited) return limited;
    const body = await readJson(request);
    const { id } = await params;
    await updateStops(store, id, secrets(request).ownerKey, body.token);
    return json(await getRoom(store, id, secrets(request)));
  } catch (error) {
    return handleError(error);
  }
}

/** Organiser: close or reopen voting. */
export async function PATCH(request: Request, { params }: Context) {
  const found = requireStore();
  if (found.response) return found.response;
  const store = found.store;
  try {
    const limited = await limit(store, request, "write", 60, 60);
    if (limited) return limited;
    const body = await readJson(request);
    const { id } = await params;
    if (typeof body.closed !== "boolean") {
      return json({ error: "Expected { closed: boolean }" }, 400);
    }
    await setClosed(store, id, secrets(request).ownerKey, body.closed);
    return json(await getRoom(store, id, secrets(request)));
  } catch (error) {
    return handleError(error);
  }
}

/** Organiser: delete the room and all votes. */
export async function DELETE(request: Request, { params }: Context) {
  const found = requireStore();
  if (found.response) return found.response;
  const store = found.store;
  try {
    const limited = await limit(store, request, "write", 60, 60);
    if (limited) return limited;
    await deleteRoom(store, (await params).id, secrets(request).ownerKey);
    return json({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
