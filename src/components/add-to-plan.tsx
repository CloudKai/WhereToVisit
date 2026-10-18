"use client";
import { MAX_STOPS_PER_DAY, MAX_TOTAL_STOPS, type Stop } from "@/lib/plan";
import { usePlan } from "./plan-provider";

export function AddToPlanButton({
  stop,
  destination,
}: {
  stop: Stop | null;
  destination?: string;
}) {
  const { plan, activeDay, dayOf, add, remove, dayFull, tripFull, hydrated } =
    usePlan();

  if (!stop) {
    return (
      <p className="hint add-hint">
        No map position is published, so this place can’t be added to a trip.
      </p>
    );
  }
  const multiDay = plan.days.length > 1;
  const where = hydrated ? dayOf(stop.id) : -1;
  if (where >= 0) {
    return (
      <button
        type="button"
        className="add-button added"
        aria-pressed="true"
        onClick={() => remove(stop.id)}
      >
        {multiDay
          ? `✓ In Day ${where + 1} · remove`
          : "✓ In your trip · remove"}
      </button>
    );
  }
  if (tripFull) {
    return (
      <button type="button" className="add-button" disabled>
        Your trip is full ({MAX_TOTAL_STOPS} stops)
      </button>
    );
  }
  if (dayFull) {
    return (
      <button type="button" className="add-button" disabled>
        Day {activeDay + 1} is full ({MAX_STOPS_PER_DAY} stops)
      </button>
    );
  }
  return (
    <button
      type="button"
      className="add-button"
      aria-pressed="false"
      disabled={!hydrated}
      onClick={() => add(stop, destination)}
    >
      {multiDay ? `+ Add to Day ${activeDay + 1}` : "+ Add to my trip"}
    </button>
  );
}
