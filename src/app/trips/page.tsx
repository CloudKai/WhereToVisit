import Link from "next/link";
import { TripDashboard } from "@/components/trips";
export default async function Trips({
  searchParams,
}: {
  searchParams: Promise<{ placeId?: string; importId?: string }>;
}) {
  const params = await searchParams;
  return (
    <section className="page-section">
      <p className="eyebrow">YOUR PRIVATE COLLECTION</p>
      <h1>Your Trips</h1>
      <p className="lead">
        Keep your Shanghai places and the sources that inspired them.
      </p>
      <Link href="/discover" className="text-link">
        Browse discovery →
      </Link>
      <TripDashboard placeId={params.placeId} importId={params.importId} />
    </section>
  );
}
