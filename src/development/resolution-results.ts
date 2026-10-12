import "server-only";
import type { Import, Place } from "@/shared/contracts";
import { developmentImportFixturesEnabled } from "./import-source";
/** Authored external result, never admitted to real drafts or published discovery. */
export function developmentResolutionPlaces(job: Import, places: Place[]) {
  if (
    !developmentImportFixturesEnabled() ||
    !places.length ||
    job.dataKind !== "fixture" ||
    !job.sourceUrl.endsWith("/Fixture_Outside")
  )
    return places;
  const outside: Place = {
    id: "fictional-outside-cafe",
    city: "Hangzhou",
    category: "cafe",
    displayName: "Fictional Outside Café",
    localName: "虚构外地咖啡馆",
    branch: "Outside branch",
    address: "3 Fictional Outside Road, Hangzhou",
    neighbourhood: null,
    coordinates: null,
    price: null,
    operationStatus: "unknown",
    hours: null,
    rating: null,
    classifications: [],
    evidence: [
      {
        id: "fictional-outside-source",
        sourceUrl: "https://example.invalid/outside",
        capturedAt: "2026-10-12",
        publishedAt: null,
        attribution: "Authored fictional external result",
        permission: "Test-only authored content",
        status: "unverified",
        establishedFacts: ["identity"],
        limits:
          "Fictional branch; no provider connectivity or real verification.",
        recommendation: null,
      },
    ],
    providerReferences: [
      {
        provider: "Scenario map",
        placeId: "fictional-outside-poi",
        url: "https://example.invalid/outside-map",
        linkKind: "place",
        surface: "Authored fictional exact result",
        apiVersion: null,
        returnedName: "Fictional Outside Café",
        returnedAddress: "3 Fictional Outside Road, Hangzhou",
        language: "en",
        coordinates: null,
        verifiedAt: "2026-10-12",
        qualification: "qualified",
        qualificationNotes:
          "Authored fixture only; no actual provider connectivity, operation or coordinates established.",
      },
    ],
  };
  return [...places, outside];
}
