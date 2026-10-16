"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  addDay,
  addStop,
  clampDayIndex,
  decodePlan,
  EMPTY_PLAN,
  encodePlan,
  findStop,
  MAX_DAYS,
  MAX_STOPS_PER_DAY,
  MAX_TOTAL_STOPS,
  moveStop,
  moveStopToDay,
  type Plan,
  removeDay,
  removeStop,
  reorderDay,
  setDayMode,
  setDayStart,
  setDwell,
  type Stop,
  stopCount,
  tokenFromHash,
} from "@/lib/plan";
import type { Mode } from "@/lib/routing";

const STORAGE_KEY = "wtv.plan.v2";
const DAY_KEY = "wtv.plan.day";

type PlanContext = {
  plan: Plan;
  /** False until the browser has loaded any saved plan; avoids flicker. */
  hydrated: boolean;
  /** The day that "Add to my trip" adds to (0-based). */
  activeDay: number;
  setActiveDay: (index: number) => void;
  /** True when the active day, or the whole trip, can take no more stops. */
  dayFull: boolean;
  tripFull: boolean;
  canAddDay: boolean;
  /** Which day (0-based) holds this stop, or -1. */
  dayOf: (id: string) => number;
  add: (stop: Stop, destination?: string) => void;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  moveToDay: (id: string, day: number) => void;
  setDwellFor: (id: string, minutes: number) => void;
  applyOrder: (day: number, order: number[]) => void;
  setStart: (day: number, minutes: number) => void;
  setMode: (day: number, mode: Mode) => void;
  addNewDay: () => void;
  removeDayAt: (day: number) => void;
  replace: (plan: Plan) => void;
  clear: () => void;
};

const Context = createContext<PlanContext | null>(null);

export function usePlan(): PlanContext {
  const value = useContext(Context);
  if (!value) throw new Error("usePlan must be used inside <PlanProvider>");
  return value;
}

function readInitialPlan(): Plan {
  // A shared link wins over what this tab remembers.
  if (window.location.pathname === "/plan") {
    const token = tokenFromHash(window.location.hash);
    const shared = token ? decodePlan(token) : null;
    if (shared && stopCount(shared) > 0) return shared;
  }
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return (stored ? decodePlan(stored) : null) ?? EMPTY_PLAN;
  } catch {
    return EMPTY_PLAN;
  }
}

/**
 * Holds the trip plan for this browser tab. Nothing is sent to a server:
 * it is kept in sessionStorage and can be shared as a link.
 */
export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [day, setDay] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = readInitialPlan();
    setPlan(initial);
    try {
      const saved = Number(window.sessionStorage.getItem(DAY_KEY));
      setDay(clampDayIndex(initial, saved));
    } catch {
      setDay(0);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (stopCount(plan) === 0 && plan.days.length === 1) {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(STORAGE_KEY, encodePlan(plan));
      }
      window.sessionStorage.setItem(DAY_KEY, String(day));
    } catch {
      // Storage can be unavailable (private mode); the plan still works in memory.
    }
  }, [plan, day, hydrated]);

  // Removing days can leave the selection past the end.
  const activeDay = clampDayIndex(plan, day);

  const add = useCallback(
    (stop: Stop, destination?: string) =>
      setPlan((p) => addStop(p, stop, destination, clampDayIndex(p, day))),
    [day],
  );
  const remove = useCallback(
    (id: string) => setPlan((p) => removeStop(p, id)),
    [],
  );
  const move = useCallback(
    (id: string, delta: -1 | 1) => setPlan((p) => moveStop(p, id, delta)),
    [],
  );
  const moveToDay = useCallback(
    (id: string, to: number) => setPlan((p) => moveStopToDay(p, id, to)),
    [],
  );
  const setDwellFor = useCallback(
    (id: string, minutes: number) => setPlan((p) => setDwell(p, id, minutes)),
    [],
  );
  const applyOrder = useCallback(
    (index: number, order: number[]) =>
      setPlan((p) => reorderDay(p, index, order)),
    [],
  );
  const setStart = useCallback(
    (index: number, minutes: number) =>
      setPlan((p) => setDayStart(p, index, minutes)),
    [],
  );
  const setMode = useCallback(
    (index: number, mode: Mode) => setPlan((p) => setDayMode(p, index, mode)),
    [],
  );
  const addNewDay = useCallback(() => {
    setPlan((p) => addDay(p));
    // Jump to the day that was just added (the last one).
    setDay((current) =>
      plan.days.length < MAX_DAYS ? plan.days.length : current,
    );
  }, [plan.days.length]);
  const removeDayAt = useCallback(
    (index: number) => setPlan((p) => removeDay(p, index)),
    [],
  );
  const replace = useCallback((next: Plan) => {
    setPlan(next);
    setDay(0);
  }, []);
  const clear = useCallback(() => {
    setPlan(EMPTY_PLAN);
    setDay(0);
  }, []);

  const value = useMemo<PlanContext>(
    () => ({
      plan,
      hydrated,
      activeDay,
      setActiveDay: (index) => setDay(clampDayIndex(plan, index)),
      dayFull: plan.days[activeDay].stops.length >= MAX_STOPS_PER_DAY,
      tripFull: stopCount(plan) >= MAX_TOTAL_STOPS,
      canAddDay: plan.days.length < MAX_DAYS,
      dayOf: (id) => findStop(plan, id)?.day ?? -1,
      add,
      remove,
      move,
      moveToDay,
      setDwellFor,
      applyOrder,
      setStart,
      setMode,
      addNewDay,
      removeDayAt,
      replace,
      clear,
    }),
    [
      plan,
      hydrated,
      activeDay,
      add,
      remove,
      move,
      moveToDay,
      setDwellFor,
      applyOrder,
      setStart,
      setMode,
      addNewDay,
      removeDayAt,
      replace,
      clear,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
