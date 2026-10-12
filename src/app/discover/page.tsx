import { Discovery } from "@/components/discovery";
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
      <Discovery
        initialResult={result}
        mapFixtureEnabled={
          process.env.NODE_ENV === "development" &&
          process.env.ENABLE_DEVELOPMENT_MAP_FIXTURE === "1"
        }
      />
    </section>
  );
}
