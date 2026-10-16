import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reviewedBranchPhotos } from "../shared/branch-photo";

/** Filenames come only from the reviewed registry, never from a URL or batch path. */
export function readReviewedPhoto(assetId: string) {
  const asset = Object.hasOwn(reviewedBranchPhotos, assetId)
    ? reviewedBranchPhotos[assetId]
    : null;
  if (!asset) throw new Error("Unreviewed branch photo.");
  const path = resolve("data/catalogue/photos", asset.filename);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.bytes)
    throw new Error("Invalid branch photo file.");
  const bytes = readFileSync(path);
  if (
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff ||
    createHash("sha256").update(bytes).digest("hex") !== asset.photo.sha256
  )
    throw new Error("Invalid branch photo bytes.");
  return bytes;
}
