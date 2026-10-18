import {
  handleError,
  json,
  limit,
  readJson,
  requireStore,
} from "@/lib/room-http";
import { castVote, getRoom } from "@/lib/rooms";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const found = requireStore();
  if (found.response) return found.response;
  const store = found.store;
  try {
    const limited = await limit(store, request, "vote", 90, 60);
    if (limited) return limited;
    const body = await readJson(request);
    const { id } = await params;
    await castVote(store, id, {
      participantId: body.participantId,
      name: body.name,
      stopId: body.stopId,
      vote: body.vote,
    });
    return json(
      await getRoom(store, id, {
        participantId:
          typeof body.participantId === "string"
            ? body.participantId
            : undefined,
        ownerKey: request.headers.get("x-owner-key") ?? undefined,
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}
