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
  addStop,
  decodePlan,
  EMPTY_PLAN,
  encodePlan,
  MAX_STOPS,
  moveStop,
  type Plan,
  removeStop,
  reorder,
  setDwell,
  type Stop,
  tokenFromHash,
} from "@/lib/plan";

const STORAGE_KEY = "wtv.plan.v1";

type PlanContext = {
  plan: Plan;
  /** False until the browser has loaded any saved plan; avoids flicker. */
  hydrated: boolean;
  full: boolean;
  has: (id: string) => boolean;
  add: (stop: Stop, destination?: string) => void;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  setDwellFor: (id: string, minutes: number) => void;
  applyOrder: (order: number[]) => void;
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
    if (shared && shared.stops.length > 0) return shared;
  }
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return (stored ? decodePlan(stored) : null) ?? EMPTY_PLAN;
  } catch {
    return EMPTY_PLAN;
  }
}

/**
 * Holds the day plan for this browser tab. Nothing is sent to a server:
 * it is kept in sessionStorage and can be shared as a link.
 */
export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPlan(readInitialPlan());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (plan.stops.length === 0)
        window.sessionStorage.removeItem(STORAGE_KEY);
      else window.sessionStorage.setItem(STORAGE_KEY, encodePlan(plan));
    } catch {
      // Storage can be unavailable (private mode); the plan still works in memory.
    }
  }, [plan, hydrated]);

  const add = useCallback(
    (stop: Stop, destination?: string) =>
      setPlan((p) => addStop(p, stop, destination)),
    [],
  );
  const remove = useCallback(
    (id: string) => setPlan((p) => removeStop(p, id)),
    [],
  );
  const move = useCallback(
    (id: string, delta: -1 | 1) => setPlan((p) => moveStop(p, id, delta)),
    [],
  );
  const setDwellFor = useCallback(
    (id: string, minutes: number) => setPlan((p) => setDwell(p, id, minutes)),
    [],
  );
  const applyOrder = useCallback(
    (order: number[]) => setPlan((p) => reorder(p, order)),
    [],
  );
  const replace = useCallback((next: Plan) => setPlan(next), []);
  const clear = useCallback(() => setPlan(EMPTY_PLAN), []);

  const value = useMemo<PlanContext>(
    () => ({
      plan,
      hydrated,
      full: plan.stops.length >= MAX_STOPS,
      has: (id) => plan.stops.some((s) => s.id === id),
      add,
      remove,
      move,
      setDwellFor,
      applyOrder,
      replace,
      clear,
    }),
    [
      plan,
      hydrated,
      add,
      remove,
      move,
      setDwellFor,
      applyOrder,
      replace,
      clear,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
