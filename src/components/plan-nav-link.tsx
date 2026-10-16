"use client";
import Link from "next/link";
import { stopCount } from "@/lib/plan";
import { usePlan } from "./plan-provider";

export function PlanNavLink() {
  const { plan, hydrated } = usePlan();
  const count = hydrated ? stopCount(plan) : 0;
  return (
    <Link href="/plan" className="plan-link">
      Your trip
      {count > 0 && (
        <span className="badge" aria-label={`${count} stops`}>
          {count}
        </span>
      )}
    </Link>
  );
}
