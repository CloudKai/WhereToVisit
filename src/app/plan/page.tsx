import type { Metadata } from "next";
import { PlanView } from "@/components/plan-view";

export const metadata: Metadata = {
  title: "Your day — WhereToVisit",
  robots: { index: false },
};

export default function PlanPage() {
  return <PlanView />;
}
