"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";

export type WorkspaceActivity = {
  busy: boolean;
  error: string;
  dirty?: boolean;
  interrupted?: boolean;
  label?: string;
};
export type WorkspaceDay = {
  visitDate: string | null;
  includedIds: string[];
  needsReview: boolean;
  hasDraft: boolean;
  hasPlan: boolean;
};
type View = "places" | "group" | "day" | "manage";
const labels: Record<View, string> = {
  places: "Places",
  group: "Group",
  day: "Day",
  manage: "Manage",
};
export function TripWorkspace({
  workspaceId,
  owner = false,
  title,
  participantRole,
  savedCount,
  selectedCount,
  day,
  activity,
  pendingSuggestions = 0,
  children,
}: {
  workspaceId: string;
  owner?: boolean;
  title: string;
  participantRole: string;
  savedCount: number;
  selectedCount: number;
  day?: WorkspaceDay;
  activity: WorkspaceActivity[];
  pendingSuggestions?: number;
  children: Record<View, ReactNode>;
}) {
  const guest = !owner;
  const [view, setView] = useState<View>(guest ? "group" : "places");
  const requiresConfirmation = activity.some(
    (item) => item.dirty || item.interrupted,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef(false);
  const editedRef = useRef(false);
  const historyMarker = useRef("");
  useEffect(() => {
    editedRef.current = requiresConfirmation;
  }, [requiresConfirmation]);
  useEffect(() => {
    function readView() {
      const params = new URLSearchParams(window.location.search);
      const value = params.get("view");
      const next =
        value && Object.hasOwn(labels, value) && (!guest || value !== "manage")
          ? (value as View)
          : guest
            ? "group"
            : "places";
      setView(next);
      if (value !== next) {
        params.set("view", next);
        window.history.replaceState(
          window.history.state,
          "",
          `?${params.toString()}`,
        );
      }
    }
    readView();
    // A same-URL boundary lets Back ask before leaving the mounted workspace.
    // Next sees the same route while this choice is made, so cancelled departure
    // cannot unmount fields or retry closures. No form state enters history.
    const state = window.history.state ?? {};
    const marker =
      state.tripWorkspaceId === workspaceId && state.tripWorkspaceMarker
        ? state.tripWorkspaceMarker
        : crypto.randomUUID();
    historyMarker.current = marker;
    if (state.tripWorkspaceId !== workspaceId || !state.tripWorkspaceMarker) {
      window.history.replaceState(
        {
          ...state,
          tripWorkspaceId: workspaceId,
          tripWorkspaceMarker: marker,
          tripWorkspaceBoundary: true,
        },
        "",
        window.location.href,
      );
      window.history.pushState(
        { ...state, tripWorkspaceId: workspaceId, tripWorkspaceMarker: marker },
        "",
        window.location.href,
      );
    }
    function onBack(event: PopStateEvent) {
      if (
        event.state?.tripWorkspaceMarker === marker &&
        event.state?.tripWorkspaceBoundary
      ) {
        if (
          editedRef.current &&
          !window.confirm(
            "Leave this Trip workspace? Unsaved fields and interrupted-request retries will be discarded. Saved changes stay saved.",
          )
        ) {
          window.history.forward();
        } else {
          window.history.back();
        }
        return;
      }
      focusNext.current = true;
      readView();
    }
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [guest, workspaceId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus follows a committed view change.
  useEffect(() => {
    if (focusNext.current) {
      heading.current?.focus();
      focusNext.current = false;
    }
  }, [view]);
  // Drafts live in the mounted panes. Leaving the workspace needs an explicit
  // choice once fields were edited; no field or retry credential is persisted.
  useEffect(() => {
    if (!requiresConfirmation) return;
    function unload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    function leave(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest("a");
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const destination = new URL(link.href, window.location.href);
      if (destination.pathname === window.location.pathname) return;
      if (
        !window.confirm(
          "Leave this Trip workspace? Unsaved fields and interrupted-request retries will be discarded. Saved changes stay saved.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
    };
  }, [requiresConfirmation]);
  function destination(next: View) {
    const params = new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search,
    );
    params.set("view", next);
    return `?${params.toString()}`;
  }
  function open(next: View) {
    if (next === view) return;
    window.history.pushState(
      {
        ...window.history.state,
        tripWorkspaceId: workspaceId,
        tripWorkspaceMarker: historyMarker.current,
        tripWorkspaceBoundary: false,
      },
      "",
      destination(next),
    );
    focusNext.current = true;
    setView(next);
  }
  const next = guest
    ? {
        view: "group" as View,
        label: "Share your choices",
        explanation: "Suggest, comment or vote. The organiser chooses the day.",
      }
    : !savedCount
      ? {
          view: "places" as View,
          label: "Add Places",
          explanation: "Start with a saved shortlist. You can plan solo.",
        }
      : pendingSuggestions
        ? {
            view: "group" as View,
            label: "Review suggestions",
            explanation: `${pendingSuggestions} suggestions await your review.`,
          }
        : !selectedCount
          ? {
              view: "places" as View,
              label: "Choose Places for the day",
              explanation:
                "Saving keeps a Place in your shortlist. Choose it separately for a day.",
            }
          : {
              view: "day" as View,
              label: day?.needsReview
                ? "Review the changed day"
                : day?.hasPlan
                  ? "Review your day"
                  : day?.hasDraft
                    ? "Review inputs and generate a day"
                    : "Set your visit day",
              explanation:
                "Review inputs and warnings before visiting. Real timings remain unresolved.",
            };
  const waiting = activity.some((item) => item.busy);
  const failed = activity.some((item) => item.error);
  return (
    <section aria-label="Trip workspace" className="trip-workspace">
      <header className="trip-workspace-header">
        <p className="eyebrow">SHANGHAI · YOUR TRIP</p>
        <h2>{title}</h2>
        <p>
          {participantRole}
          {day
            ? day.visitDate
              ? ` · Saved visit ${day.visitDate} (Shanghai)`
              : " · Saved visit date unset"
            : failed
              ? " · Saved visit date unavailable"
              : " · Checking saved visit date…"}
        </p>
        <p role="status" className="workspace-update">
          {waiting
            ? "Update pending — waiting for confirmation."
            : failed
              ? "An update needs attention. Open its view to retry."
              : "Latest reads and completed updates confirmed."}
          {activity.some((item) => item.dirty) &&
            ` Unsaved fields in ${activity
              .filter((item) => item.dirty)
              .map((item) => item.label ?? "Trip")
              .join(
                ", ",
              )}. View changes keep them; use each form’s Save to confirm.`}
          {activity.some((item) => item.interrupted) &&
            " An interrupted change needs an explicit retry."}
        </p>
        <p className="workspace-counts">
          {savedCount} saved in shortlist · {selectedCount} chosen for day ·{" "}
          {day
            ? `${day.includedIds.length} included stops${day.needsReview ? " (needs review)" : ""}`
            : "Day status loading"}
        </p>
      </header>
      <nav aria-label="Trip views" className="trip-view-navigation">
        {(
          ["places", "group", "day", ...(!guest ? ["manage"] : [])] as View[]
        ).map((item) => (
          <a
            key={item}
            href={destination(item)}
            aria-current={view === item ? "page" : undefined}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              open(item);
            }}
          >
            {labels[item]}
          </a>
        ))}
      </nav>
      <aside className="workspace-next" aria-label="Next Trip action">
        <p>{next.explanation}</p>
        {!guest && !savedCount ? (
          <a href="/discover">Discover Places →</a>
        ) : (
          <button type="button" onClick={() => open(next.view)}>
            {next.label} →
          </button>
        )}
      </aside>
      <h3 ref={heading} tabIndex={-1} className="workspace-view-heading">
        {labels[view]}
      </h3>
      <p className="workspace-navigation-note">
        Views keep your drafts and interrupted-request retries. Use Back and
        Forward to return between views.
      </p>
      {(Object.keys(labels) as View[])
        .filter((item) => !guest || item !== "manage")
        .map((item) => (
          <div
            key={item}
            hidden={view !== item}
            inert={view !== item}
            className="trip-workspace-pane"
            data-view={item}
          >
            {children[item]}
          </div>
        ))}
    </section>
  );
}
