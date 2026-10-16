import type { Metadata } from "next";
import { GuestTrip } from "@/components/invitations";
export const metadata: Metadata = {
  title: "Trip invitation — WhereToVisit",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Join({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <section className="page-section trip-page">
      <h1>Trip invitation</h1>
      <GuestTrip token={(await params).token} />
    </section>
  );
}
