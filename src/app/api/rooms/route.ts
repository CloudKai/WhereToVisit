import {
  handleError,
  json,
  limit,
  readJson,
  requireStore,
} from "@/lib/room-http";
import { createRoom } from "@/lib/rooms";

export async function POST(request: Request) {
  const found = requireStore();
  if (found.response) return found.response;
  const store = found.store;
  try {
    const limited = await limit(store, request, "create", 10, 3600);
    if (limited) return limited;
    const body = await readJson(request);
    return json(await createRoom(store, body.token), 201);
  } catch (error) {
    return handleError(error);
  }
}
