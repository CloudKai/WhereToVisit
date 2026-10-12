import "server-only";
import { existsSync } from "node:fs";
import type {
  CatalogueQuery,
  CatalogueResult,
  OperationResult,
} from "@/shared/contracts";
import {
  intersectDiscoveryArea,
  matchesDiscoveryQuery,
  sameMapArea,
} from "@/shared/discovery-query";
import {
  loadCatalogueFile,
  readCataloguePublication,
} from "./catalogue-publication";
export interface CatalogueProvider {
  query(input: CatalogueQuery): Promise<OperationResult<CatalogueResult>>;
}
const catalogue: CatalogueProvider = {
  async query(input) {
    if (input.area && input.area.system !== "WGS-84")
      return {
        status: "unavailable",
        reason: "coordinate-system-unsupported",
        message:
          "Area search supports the bounded WGS-84 discovery envelope only. Other map coordinate systems remain unqualified; no conversion is performed.",
      };
    if (input.city !== "Shanghai")
      return {
        status: "unavailable",
        reason: "city-not-supported",
        message: "The initial catalogue covers Shanghai only.",
      };
    const source = process.env.CATALOGUE_DEVELOPMENT_SOURCE;
    if (
      process.env.NODE_ENV === "development" &&
      source &&
      existsSync(source)
    ) {
      try {
        loadCatalogueFile(source, true);
      } catch {
        return {
          status: "error",
          reason: "catalogue-invalid",
          message:
            "The catalogue could not be loaded safely. No new records were published.",
          retryable: false,
        };
      }
    }
    try {
      const batch = readCataloguePublication();
      if (
        !batch ||
        (batch.kind === "fixture" && process.env.NODE_ENV !== "development")
      )
        return {
          status: "unavailable",
          reason: "catalogue-not-ready",
          message:
            "The Shanghai shortlist is not available yet. Recommendations will appear here when their places and sources have been checked.",
        };
      if (batch.status === "unavailable")
        return {
          status: "unavailable",
          reason: batch.unavailableReason?.code ?? "catalogue-not-ready",
          message: batch.unavailableReason?.message ?? batch.coverageMessage,
        };
      const searchedArea = input.area
        ? intersectDiscoveryArea(input.area)
        : null;
      const excludedCoordinateCount = input.area
        ? batch.places.filter(
            (place) =>
              !place.coordinates ||
              place.coordinates.system !== input.area?.system,
          ).length
        : 0;
      const outcome = !searchedArea
        ? "outside-coverage"
        : sameMapArea(searchedArea, input.area ?? null)
          ? "searched"
          : "clipped";
      const areaMessage = input.area
        ? `${outcome === "outside-coverage" ? "This area is outside the bounded Shanghai discovery envelope." : outcome === "clipped" ? "Only the intersection with the bounded Shanghai discovery envelope was searched." : "Searched within the bounded Shanghai discovery envelope."} This envelope is not an administrative boundary or exhaustive venue coverage. ${excludedCoordinateCount} catalogue records have missing or incompatible coordinates and cannot appear in area results. An empty result does not mean there are no venues here.`
        : "";
      return {
        status: "available",
        data: {
          ...(input.area
            ? {
                areaSearch: {
                  requestedArea: input.area,
                  searchedArea,
                  outcome,
                  excludedCoordinateCount,
                },
              }
            : {}),
          places: batch.places.filter(
            (place) =>
              (!input.area || searchedArea !== null) &&
              matchesDiscoveryQuery(place, {
                ...input,
                ...(searchedArea ? { area: searchedArea } : {}),
              }),
          ),
          coverageMessage: [batch.coverageMessage, areaMessage]
            .filter(Boolean)
            .join(" "),
          dataKind: batch.kind,
        },
      };
    } catch {
      return {
        status: "unavailable",
        reason: "catalogue-storage-not-ready",
        message:
          "The Shanghai shortlist is temporarily unavailable. Please try again later.",
      };
    }
  },
};
export async function queryCatalogue(
  input: CatalogueQuery,
  provider: CatalogueProvider = catalogue,
) {
  return provider.query(input);
}
