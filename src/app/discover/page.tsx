import { CatalogueList } from "@/components/catalogue-list";
import { OperationState } from "@/components/operation-state";
import { queryCatalogue } from "@/server/catalogue";
export const dynamic = "force-dynamic";
export default async function Discover() {
  const result = await queryCatalogue({ city: "Shanghai" });
  return (
    <section className="page-section">
      <p className="eyebrow">DISCOVER / SHANGHAI</p>
      <h1>Discover Shanghai</h1>
      <p className="lead">
        Food and cafés, with the story behind each recommendation.
      </p>
      {result.status === "available" && (
        <CatalogueList catalogue={result.data} />
      )}
      {result.status !== "available" && (
        <OperationState
          kind={result.status}
          title="A shortlist worth waiting for"
          message={result.message}
        />
      )}
    </section>
  );
}
