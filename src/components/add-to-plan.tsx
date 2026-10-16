"use client";
import { MAX_STOPS, type Stop } from "@/lib/plan";
import { usePlan } from "./plan-provider";

export function AddToPlanButton({
  stop,
  destination,
}: {
  stop: Stop | null;
  destination?: string;
}) {
  const { has, add, remove, full, hydrated } = usePlan();

  if (!stop) {
    return (
      <p className="hint add-hint">
        No map position is published, so this place can’t be added to a day.
      </p>
    );
  }
  const added = hydrated && has(stop.id);
  if (!added && full) {
    return (
      <button type="button" className="add-button" disabled>
        Your day is full ({MAX_STOPS} stops)
      </button>
    );
  }
  return (
    <button
      type="button"
      className={added ? "add-button added" : "add-button"}
      aria-pressed={added}
      disabled={!hydrated}
      onClick={() => (added ? remove(stop.id) : add(stop, destination))}
    >
      {added ? "✓ In your day · remove" : "+ Add to my day"}
    </button>
  );
}
