import type { BranchPhoto } from "./contracts";

/** Reviewed assets only. Adding a photo requires independent rights and branch review. */
export const reviewedBranchPhotos: Record<
  string,
  { placeId: string; filename: string; bytes: number; photo: BranchPhoto }
> = {
  "roastery-codas-2024": {
    placeId: "roastery-shanghai",
    filename: "roastery-codas-2024.jpg",
    bytes: 5654473,
    photo: {
      assetId: "roastery-codas-2024",
      title: "Starbucks Reserve Roastery Shanghai 02.jpg",
      alt: "Coffee roasting equipment and transport pipes inside the Shanghai Roastery in October 2024",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Starbucks_Reserve_Roastery_Shanghai_02.jpg",
      originalUrl:
        "https://upload.wikimedia.org/wikipedia/commons/4/43/Starbucks_Reserve_Roastery_Shanghai_02.jpg",
      author: "Codas",
      authorUrl: "https://commons.wikimedia.org/wiki/User:Codas",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      photographedAt: "2024-10-28",
      publishedAt: "2024-12-02T15:32:00Z",
      checkedAt: "2026-10-14",
      relevance:
        "The uploader identifies the Shanghai Roastery; the photograph shows its roasting equipment and interior. It does not confirm present operation or an exact map pin.",
      changes: "Original unchanged; displayed smaller without cropping.",
      width: 5712,
      height: 4284,
      sha256:
        "8d0bc23c3ed12fd5305bcbbf266e6c08f0de7435f51230b636c38ac6054cc6c9",
      rightsStatus: "qualified",
      rightsExpiresAt: null,
    },
  },
};

/** Recheck retained/client snapshots against today's reviewed allowlist before use. */
export function eligibleBranchPhoto(
  photo: BranchPhoto | null | undefined,
  placeId: string,
  now = Date.now(),
): BranchPhoto | null {
  if (!photo) return null;
  const reviewed = Object.hasOwn(reviewedBranchPhotos, photo.assetId)
    ? reviewedBranchPhotos[photo.assetId]
    : null;
  if (!reviewed || reviewed.placeId !== placeId) return null;
  for (const [key, value] of Object.entries(reviewed.photo)) {
    if (key === "rightsStatus" || key === "rightsExpiresAt") continue;
    if (photo[key as keyof BranchPhoto] !== value) return null;
  }
  if (
    reviewed.photo.rightsStatus !== "qualified" ||
    photo.rightsStatus !== "qualified" ||
    [reviewed.photo.rightsExpiresAt, photo.rightsExpiresAt].some(
      (expiry) =>
        expiry !== null &&
        (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now),
    )
  )
    return null;
  return photo;
}

export function branchPhotoUrl(photo: BranchPhoto) {
  return `/api/catalogue/photos/${encodeURIComponent(photo.assetId)}`;
}
