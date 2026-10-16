"use client";
import Link from "next/link";
import { usePlan } from "./plan-provider";

export function PlanNavLink() {
  const { plan, hydrated } = usePlan();
  const count = hydrated ? plan.stops.length : 0;
  return (
    <Link href="/plan" className="plan-link">
      Your day
      {count > 0 && (
        <span className="badge" aria-label={`${count} stops`}>
          {count}
        </span>
      )}
    </Link>
  );
}
