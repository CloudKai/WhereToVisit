import type {
  ExtractResponse,
  Progress,
  StreamEvent,
} from "./extract-types.ts";
import { RoomError } from "./rooms.ts";

/**
 * Runs a search and streams it as newline-delimited JSON: progress events as
 * stages finish, then exactly one result or error event, then the stream closes.
 */
export function extractStream(
  run: (onProgress: (progress: Progress) => void) => Promise<ExtractResponse>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const data = await run((progress) =>
          send({ type: "progress", progress }),
        );
        send({ type: "result", data });
      } catch (error) {
        console.warn(
          `[extract] failed: ${error instanceof Error ? error.message : "error"}`,
        );
        send({
          type: "error",
          message:
            error instanceof RoomError
              ? error.message
              : "Something went wrong while finding places. Try again.",
        });
      } finally {
        controller.close();
      }
    },
  });
}
