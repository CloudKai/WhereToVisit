import "server-only";
import type {
  CatalogueQuery,
  CatalogueResult,
  OperationResult,
} from "@/shared/contracts";
/** Provider adapters are injected here; browser views never hold credentials. */
export interface CatalogueProvider {
  query(input: CatalogueQuery): Promise<OperationResult<CatalogueResult>>;
}
const unavailableCatalogue: CatalogueProvider = {
  async query() {
    return {
      status: "unavailable",
      reason: "catalogue-not-ready",
      message:
        "The Shanghai shortlist is not available yet. Recommendations will appear here when their places and sources have been checked.",
    };
  },
};
export async function queryCatalogue(
  input: CatalogueQuery,
  provider: CatalogueProvider = unavailableCatalogue,
) {
  return provider.query(input);
}
