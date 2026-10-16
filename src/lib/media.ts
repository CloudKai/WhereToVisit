import { IMAGE_MAX_SIDE, MAX_IMAGE_CHARS } from "./extract-types.ts";

/** Scales a size down so its longest side is at most `max`; never scales up. */
export function fitSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Moments in a video to take a picture of: evenly spread, away from the very
 * start and end (which are often black or a title card).
 */
export function evenTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || count < 1) return [0];
  const margin = Math.min(0.4, duration / 10);
  const span = Math.max(0, duration - 2 * margin);
  if (count === 1) return [round(margin + span / 2)];
  return Array.from({ length: count }, (_, i) =>
    round(margin + (span * i) / (count - 1)),
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

export const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_FILE_BYTES = 400 * 1024 * 1024;
/** Pictures taken from one screen recording. */
export const FRAMES_PER_VIDEO = 6;

export class MediaError extends Error {}

// ---------- browser-only below: needs a canvas ----------

/** Draws to a canvas and returns a JPEG data URL small enough to send. */
function canvasToJpeg(
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  sourceWidth: number,
  sourceHeight: number,
): string {
  let side = IMAGE_MAX_SIDE;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { width, height } = fitSize(sourceWidth, sourceHeight, side);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new MediaError("This browser can’t prepare images.");
    ctx.fillStyle = "#fff"; // a flat background for transparent screenshots
    ctx.fillRect(0, 0, width, height);
    draw(ctx, width, height);
    const url = canvas.toDataURL("image/jpeg", attempt < 2 ? 0.8 : 0.6);
    if (url.length <= MAX_IMAGE_CHARS) return url;
    side = Math.round(side * 0.8);
  }
  throw new MediaError("That picture is too detailed to shrink enough.");
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall back to an <img> below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new MediaError(
      `“${file.name}” can’t be read here. Use a screenshot saved as PNG or JPEG.`,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageToDataUrl(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new MediaError(`“${file.name}” is too large (over 25 MB).`);
  }
  const image = await loadImage(file);
  const w = "naturalWidth" in image ? image.naturalWidth : image.width;
  const h = "naturalHeight" in image ? image.naturalHeight : image.height;
  return canvasToJpeg(
    (ctx, width, height) => ctx.drawImage(image, 0, 0, width, height),
    w,
    h,
  );
}

function waitFor(
  target: HTMLVideoElement,
  event: string,
  ms: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new MediaError("The video took too long to read.")),
      ms,
    );
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    target.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(
          new MediaError(
            "This browser can’t play that video. Try screenshots instead.",
          ),
        );
      },
      { once: true },
    );
  });
}

/** Takes evenly spaced pictures from a video, on this device. The video is never uploaded. */
export async function videoToFrames(
  file: File,
  count = FRAMES_PER_VIDEO,
): Promise<string[]> {
  if (file.size > MAX_VIDEO_FILE_BYTES) {
    throw new MediaError(`“${file.name}” is too large (over 400 MB).`);
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    video.src = url;
    await waitFor(video, "loadedmetadata", 10000);
    if (!video.videoWidth || !video.videoHeight) {
      throw new MediaError(
        "This browser can’t read that video. Try screenshots instead.",
      );
    }
    const frames: string[] = [];
    for (const time of evenTimes(video.duration, count)) {
      const seeked = waitFor(video, "seeked", 8000);
      video.currentTime = time;
      await seeked;
      frames.push(
        canvasToJpeg(
          (ctx, width, height) => ctx.drawImage(video, 0, 0, width, height),
          video.videoWidth,
          video.videoHeight,
        ),
      );
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/** Turns picked files into pictures: images directly, videos as several frames. */
export async function filesToImages(
  files: File[],
  room: number,
): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    if (out.length >= room) break;
    if (file.type.startsWith("video/")) {
      out.push(
        ...(await videoToFrames(
          file,
          Math.min(FRAMES_PER_VIDEO, room - out.length),
        )),
      );
    } else if (file.type.startsWith("image/")) {
      out.push(await imageToDataUrl(file));
    } else {
      throw new MediaError(`“${file.name}” isn’t a picture or a video.`);
    }
  }
  return out.slice(0, room);
}
