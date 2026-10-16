import { TripDashboard } from "@/components/trips";
export default async function Trips({
  searchParams,
}: {
  searchParams: Promise<{
    placeId?: string;
    importId?: string;
    intentId?: string;
  }>;
}) {
  const params = await searchParams;
  return (
    <section className="page-section trip-page">
      <h1>Your Trips</h1>
      <TripDashboard
        placeId={params.placeId}
        importId={params.importId}
        pendingIntentId={params.intentId}
      />
    </section>
  );
}
