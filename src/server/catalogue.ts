import "server-only";
import { existsSync } from "node:fs";
import type {
  CatalogueQuery,
  CatalogueResult,
  OperationResult,
} from "@/shared/contracts";
import {
  loadCatalogueFile,
  readCataloguePublication,
} from "./catalogue-publication";
export interface CatalogueProvider {
  query(input: CatalogueQuery): Promise<OperationResult<CatalogueResult>>;
}
const catalogue: CatalogueProvider = {
  async query(input) {
    if (Object.keys(input).some((key) => key !== "city"))
      return {
        status: "unavailable",
        reason: "query-not-supported",
        message: "Catalogue filters and map queries are not available yet.",
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
      return {
        status: "available",
        data: {
          places: batch.places,
          coverageMessage: batch.coverageMessage,
          dataKind: batch.kind,
        },
      };
    } catch {
      return {
        status: "unavailable",
        reason: "catalogue-storage-not-ready",
        message:
          "The Shanghai shortlist is unavailable. Apply the local database migrations and load the reviewed catalogue publication before serving discovery.",
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
