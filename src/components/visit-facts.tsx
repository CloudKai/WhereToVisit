import type { SavedVisitFacts } from "@/shared/contracts";

export function VisitFacts({ facts }: { facts?: SavedVisitFacts }) {
  if (!facts) return null;
  return (
    <section aria-label="Current visit facts">
      <h4>Current visit facts</h4>
      <p>
        Manually reviewed source observations. Reopening this Trip does not
        check the venue live or establish hours for your visit date.
      </p>
      {facts.identityReviewRequired && (
        <p role="alert">
          Address or branch identity needs review. The saved address and
          searches are historical and unconfirmed; practical directions stay
          unavailable until same-branch identity is reviewed.
        </p>
      )}
      {(["address", "hours", "operation"] as const).map((field) => {
        const item = facts.fields[field];
        return (
          <div key={field}>
            <p>
              <strong>
                {field === "operation"
                  ? "Operating status"
                  : field === "hours"
                    ? "Hours"
                    : "Address"}
                :
              </strong>{" "}
              {item.value ?? "Unknown"} · {item.outcome}
              {item.checkedAt
                ? ` · Check recorded ${item.checkedAt.slice(0, 10)}`
                : " · No source check date"}
              {field === "address" && facts.identityReviewRequired
                ? " · Proposed only; identity unconfirmed"
                : ""}
            </p>
            <details>
              <summary>Check sources and limits</summary>
              <p>{item.explanation}</p>
              {item.value === null && item.lastChecked && (
                <p>
                  Last checked, historical: {item.lastChecked.value} ·{" "}
                  {item.lastChecked.checkedAt?.slice(0, 10) ?? "Date unknown"}.
                  This is not the current fact.
                </p>
              )}
              {item.sources.map((source) => (
                <p key={source.id}>
                  <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                    {source.attribution}
                  </a>{" "}
                  · Observed {source.capturedAt.slice(0, 10)} · {source.limits}
                </p>
              ))}
              {item.value === null &&
                item.lastChecked?.sources.map((source) => (
                  <p key={`historical:${source.id}`}>
                    <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                      Historical check: {source.attribution}
                    </a>{" "}
                    · Observed {source.capturedAt.slice(0, 10)} ·{" "}
                    {source.limits}
                  </p>
                ))}
            </details>
          </div>
        );
      })}
    </section>
  );
}
