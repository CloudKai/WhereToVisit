import type { Metadata } from "next";
import { RoomView } from "@/components/room-view";

export const metadata: Metadata = {
  title: "Vote on the plan — WhereToVisit",
  robots: { index: false, follow: false },
  // Keep the private link out of referrer headers sent to other sites.
  referrer: "no-referrer",
};

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <RoomView id={(await params).id} />;
}
