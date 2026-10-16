import { Discovery } from "@/components/discovery";
import { queryCatalogue } from "@/server/catalogue";
export const dynamic = "force-dynamic";
export default async function Discover({
  searchParams,
}: {
  searchParams: Promise<{ placeId?: string }>;
}) {
  const { placeId } = await searchParams;
  const result = await queryCatalogue({ city: "Shanghai" });
  return (
    <section className="page-section discovery-page">
      <p className="eyebrow">THE SHANGHAI GUIDE</p>
      <h1>Discover Shanghai</h1>
      <p className="lead">
        A small sourced shortlist. Find a reason to go, then check the branch.
      </p>
      <Discovery
        initialResult={result}
        initialPlaceId={placeId}
        mapFixtureEnabled={
          process.env.NODE_ENV === "development" &&
          process.env.ENABLE_DEVELOPMENT_MAP_FIXTURE === "1"
        }
      />
    </section>
  );
}
