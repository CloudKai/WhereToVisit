import type { Metadata } from "next";
import { GuestTrip } from "@/components/invitations";
export const metadata: Metadata = {
  title: "Shared Trip — WhereToVisit",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function SharedTrip({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <section className="page-section trip-page">
      <h1>Your guest access</h1>
      <GuestTrip tripId={(await params).id} />
    </section>
  );
}
