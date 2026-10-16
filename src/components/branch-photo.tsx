"use client";
import Image from "next/image";
import { useState } from "react";
import { branchPhotoUrl, eligibleBranchPhoto } from "@/shared/branch-photo";
import type { Place } from "@/shared/contracts";

export function BranchPhoto({
  place,
  detail = false,
}: {
  place: Place;
  detail?: boolean;
}) {
  const photo = eligibleBranchPhoto(place.photo, place.id);
  const [state, setState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  if (!photo)
    return detail ? null : (
      <p className="branch-photo-note">No reviewed branch photo yet.</p>
    );
  return (
    <figure className={`branch-photo${detail ? " branch-photo-detail" : ""}`}>
      <div className="branch-photo-frame" data-photo-state={state}>
        {state !== "failed" && (
          <Image
            src={branchPhotoUrl(photo)}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            unoptimized
            onLoad={() => setState("loaded")}
            onError={() => setState("failed")}
          />
        )}
        {state !== "loaded" && (
          <p className="branch-photo-status" role="status">
            {state === "failed"
              ? "Photo unavailable. Branch details and Save are still available."
              : "Loading branch photo…"}
          </p>
        )}
      </div>
      <figcaption>
        Photo by{" "}
        <a href={photo.authorUrl} target="_blank" rel="noreferrer">
          {photo.author}
        </a>
        {" · "}
        <a href={photo.licenseUrl} target="_blank" rel="noreferrer">
          {photo.license}
        </a>
        {" · "}
        <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
          Wikimedia Commons
        </a>
        {" · "}
        <time dateTime={photo.photographedAt}>{photo.photographedAt}</time>.
      </figcaption>
      {detail && (
        <div className="branch-photo-evidence">
          <p>
            {photo.title}. {photo.relevance}
          </p>
          <p>
            Uploaded {photo.publishedAt.slice(0, 10)}; rights and branch
            relevance checked {photo.checkedAt}. {photo.changes}
          </p>
          <p>
            <a href={branchPhotoUrl(photo)} target="_blank" rel="noreferrer">
              Open full original photo
            </a>
            {" · "}
            <a href={photo.originalUrl} target="_blank" rel="noreferrer">
              Original at Commons
            </a>
          </p>
          <p>
            The photo remains under {photo.license}. No warranties or
            endorsement are given. Any adaptation must keep compatible
            ShareAlike terms.
          </p>
        </div>
      )}
    </figure>
  );
}
