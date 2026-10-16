"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Import, ResolvedImportPlace } from "@/shared/contracts";

const active = (job: Import) =>
  job.status === "queued" || job.status === "processing";
export function ContentImport({ fixtureMode }: { fixtureMode: boolean }) {
  const [url, setUrl] = useState("");
  const [jobs, setJobs] = useState<Import[]>([]);
  const [resolvedPlaces, setResolvedPlaces] = useState<ResolvedImportPlace[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const retainedJobs = useRef<Import[]>([]);
  const refreshingGeneration = useRef<number | null>(null);
  const mutating = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if ((mutating.current || refreshingGeneration.current !== null) && !force)
      return;
    const current = ++generation.current;
    refreshingGeneration.current = current;
    setRefreshing(true);
    try {
      const response = await fetch("/api/imports", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error?.message ?? "Drafts could not be loaded.");
      if (current === generation.current) {
        if (
          retainedJobs.current.some(
            (job) =>
              new Date(job.expiresAt).getTime() <= Date.now() &&
              !value.jobs.some((retained: Import) => retained.id === job.id),
          )
        )
          setNotice(
            "An expired temporary import was removed. Import the article again to start a new draft.",
          );
        retainedJobs.current = value.jobs;
        setJobs(value.jobs);
        setResolvedPlaces(value.resolvedPlaces ?? []);
        setFetchError(null);
        setReady(true);
      }
    } catch (failure) {
      if (current === generation.current)
        setFetchError(
          failure instanceof Error
            ? failure.message
            : "Drafts unavailable. Reload to retry.",
        );
    } finally {
      if (refreshingGeneration.current === current) {
        refreshingGeneration.current = null;
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    const visibilityChanged = () => {
      const nowVisible = document.visibilityState === "visible";
      setVisible(nowVisible);
      if (nowVisible) void refresh();
    };
    setVisible(document.visibilityState === "visible");
    void refresh(true);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      generation.current++;
    };
  }, [refresh]);
  const workPending = jobs.some(active);
  useEffect(() => {
    if (!visible || !ready || busy || fetchError || !workPending) return;
    const interval = setInterval(() => void refresh(), 1500);
    return () => clearInterval(interval);
  }, [visible, ready, busy, fetchError, workPending, refresh]);
  useEffect(() => {
    if (!visible || busy || fetchError || !jobs.length) return;
    const remaining = Math.min(
      ...jobs.map((job) => new Date(job.expiresAt).getTime() - Date.now()),
    );
    // Browser timers cap at a signed 32-bit delay; do not poll distant expiry.
    const timer = setTimeout(
      () => void refresh(),
      Math.min(Math.max(remaining, 100), 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [jobs, visible, busy, fetchError, refresh]);
  async function mutate(path: string, body: object) {
    if (mutating.current) return;
    generation.current++;
    mutating.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error?.message ?? "Import operation failed.");
      await refresh(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Import operation failed. Retry explicitly.",
      );
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="import-workflow">
      <p className="import-support">
        Import listing names from a public English Wikivoyage Eat/Drink article.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate("/api/imports", { sourceUrl: url });
        }}
      >
        <label htmlFor="article-url">Supported article URL</label>
        <input
          id="article-url"
          type="url"
          required
          disabled={!ready || busy}
          maxLength={2048}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://en.wikivoyage.org/wiki/Shanghai/Old_City"
        />
        <button className="button" type="submit" disabled={busy || !ready}>
          Import article
        </button>
      </form>
      <p className="import-retention">
        Temporary drafts stay in this browser for up to 30 days. Review each
        branch before saving.
      </p>
      <details className="import-disclosure">
        <summary>Supported sources, privacy and retention</summary>
        <p>
          Supported: public English Wikivoyage articles with explicit Eat/Drink
          listing names. Social links, videos, other blogs and general prose
          analysis are unavailable.
        </p>
        <p>
          Temporary drafts belong to this browser session and expire within 30
          days. Source text is deleted immediately after extraction. These names
          can be compared with the bounded sourced shortlist. Every branch
          choice requires your confirmation. Live provider lookup and exact map
          pins remain unavailable.
        </p>
      </details>
      {fixtureMode && (
        <p className="map-fixture-label">
          Fictional import responses — development behavior only
        </p>
      )}
      <ol className="import-steps" aria-label="Import steps">
        <li>Import article</li>
        <li>Review names</li>
        <li>Confirm a branch</li>
        <li>Review Trip and Save</li>
      </ol>
      <div className="import-refresh">
        <button
          type="button"
          disabled={busy || refreshing}
          onClick={() => void refresh()}
        >
          Refresh drafts
        </button>
        <p role="status">
          {fetchError
            ? "Progress paused. Refresh to try again."
            : !ready
              ? "Loading temporary drafts…"
              : busy
                ? "Updating your import…"
                : workPending
                  ? "Checking progress while this page is visible."
                  : "Drafts are up to date. Refresh to check for changes."}
        </p>
      </div>
      {notice && <p role="status">{notice}</p>}
      {(error || fetchError) && (
        <div role="alert">
          <p>{error ?? fetchError}</p>
          <button
            type="button"
            disabled={busy || refreshing}
            onClick={() => void refresh()}
          >
            Reload drafts
          </button>
        </div>
      )}
      <div>
        {ready && !jobs.length && (
          <p>
            No temporary imports in this browser session. Paste a supported
            article to start.
          </p>
        )}
        {jobs.map((job) => (
          <article className="import-job" key={job.id}>
            <h2>
              Article import ·{" "}
              {job.mentions.length
                ? `${job.mentions.length} listing names`
                : "source review"}
            </h2>
            {job.dataKind === "fixture" && (
              <p>Fictional source result — development only</p>
            )}
            <p className="import-source">{job.sourceUrl}</p>
            <p role="status">
              {job.status === "queued"
                ? "Queued — submitted, waiting to retrieve the article"
                : job.status === "processing"
                  ? "Processing — extracting, retrieving the article and reading listing names"
                  : job.status === "awaiting-confirmation"
                    ? "Review names — find candidates, then confirm the exact branch"
                    : job.status === "unsupported"
                      ? "Unsupported import"
                      : job.status === "failed"
                        ? "Import failed"
                        : "Import finished"}
            </p>
            {job.reason && (
              <p>
                {job.reason.message} <span>({job.reason.code})</span>
              </p>
            )}
            {job.partial && (
              <p>
                Partial extraction: only supported listing names were read.
                Prose, unsupported structures or names beyond the 20-mention
                limit were not analysed.
              </p>
            )}
            <p>
              Attempt {job.attempt} of 3. Draft expires{" "}
              {new Date(job.expiresAt).toLocaleDateString()}.
            </p>
            {job.evidence && (
              <div className="import-attribution">
                <p>
                  {job.evidence.attribution}. Captured {job.evidence.capturedAt}
                  ; revision {job.evidence.revision}.
                </p>
                <p>
                  <a
                    href={job.evidence.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original article
                  </a>{" "}
                  ·{" "}
                  {job.evidence.revisionUrl && (
                    <>
                      <a
                        href={job.evidence.revisionUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source revision
                      </a>{" "}
                      ·{" "}
                    </>
                  )}
                  {job.evidence.historyUrl && (
                    <>
                      <a
                        href={job.evidence.historyUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Contributor history
                      </a>{" "}
                      ·{" "}
                    </>
                  )}
                  <a
                    href={job.evidence.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    CC BY-SA 4.0
                  </a>
                </p>
                <details>
                  <summary>Source capture and extraction limits</summary>
                  <p>
                    {job.evidence.changes} {job.evidence.limits}
                  </p>
                  {!job.sourceReplayAvailable && (
                    <p>
                      Whole-source replay is unavailable: source text is deleted
                      after extraction. Exact bounded quotations and their
                      original revision/hash remain; the hash cannot reconstruct
                      the source.
                    </p>
                  )}
                </details>
              </div>
            )}
            {job.mentions.map((mention) => (
              <section className="import-mention" key={mention.id}>
                <h3>{mention.originalText}</h3>
                <p>
                  {mention.resolutionStatus === "user-confirmed"
                    ? "User-confirmed branch"
                    : "Unresolved mention"}
                </p>
                {mention.resolution && <p>{mention.resolution.message}</p>}
                {mention.resolution?.outcome === "no-match" && (
                  <p>
                    No-match covers only our six canonical catalogue branches.
                    It does not mean this place is absent from Shanghai. Keep
                    the source wording and try candidate lookup again, or browse
                    the shortlist.
                  </p>
                )}
                {mention.candidates.length > 0 && !mention.confirmation && (
                  <p>
                    Compare the name and address below. Your confirmation
                    records your choice; it does not independently verify the
                    source-to-branch match.
                  </p>
                )}
                {mention.confirmation && (
                  <p>
                    Your selection is recorded separately from independent venue
                    evidence. It does not verify operation, location coordinates
                    or a provider pin.
                  </p>
                )}
                {mention.candidates.map((candidate) => (
                  <div className="import-candidate" key={candidate.id}>
                    <h4>
                      {candidate.place.displayName} ·{" "}
                      {candidate.place.branch ?? "Branch"}
                    </h4>
                    {candidate.place.localName && (
                      <p>{candidate.place.localName}</p>
                    )}
                    <p>{candidate.place.address}</p>
                    <p>{candidate.reason}</p>
                    <p>
                      City: {candidate.place.city}.{" "}
                      {candidate.outsideCity
                        ? "Outside Shanghai discovery."
                        : "Shanghai candidate."}
                    </p>
                    {!mention.confirmation && (
                      <button
                        type="button"
                        disabled={busy || !ready}
                        onClick={() =>
                          void mutate(`/api/imports/${job.id}/resolution`, {
                            action: "confirm",
                            mentionId: mention.id,
                            candidateId: candidate.id,
                            ...(candidate.outsideCity
                              ? { acknowledgeOutsideCity: true }
                              : {}),
                          })
                        }
                      >
                        {candidate.outsideCity
                          ? `Confirm ${candidate.place.branch ?? candidate.place.displayName} outside Shanghai`
                          : `Confirm ${candidate.place.branch ?? candidate.place.displayName}`}
                      </button>
                    )}
                    {mention.confirmation?.candidateId === candidate.id && (
                      <p>
                        Selected branch. Confirmed{" "}
                        {mention.confirmation.confirmedAt}. Exact pins remain
                        unavailable; the link is an address search.
                      </p>
                    )}
                    <details>
                      <summary>Branch sources and address search</summary>
                      {candidate.branchEvidence.map((evidence) => (
                        <p key={evidence.id}>
                          <a
                            href={evidence.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {evidence.attribution}
                          </a>{" "}
                          · Observed {evidence.capturedAt}. {evidence.limits}
                        </p>
                      ))}
                      <p>
                        {candidate.providerReference.provider}:{" "}
                        {candidate.providerReference.qualificationNotes}
                      </p>
                      {candidate.providerReference.url && (
                        <p>
                          <a
                            href={candidate.providerReference.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {candidate.providerReference.linkKind === "search"
                              ? "Search this address in an external map"
                              : "Inspect provider reference"}
                          </a>
                        </p>
                      )}
                    </details>
                  </div>
                ))}
                <p>
                  Selected city: Shanghai (your import scope; not a source
                  location fact). The extracted listing itself supplies no
                  branch or address.
                </p>
                <blockquote>{mention.extraction.quote}</blockquote>
                <details>
                  <summary>Original wording evidence</summary>
                  <p>
                    Unicode code points {mention.extraction.codePointStart}–
                    {mention.extraction.codePointEnd} (end exclusive), revision{" "}
                    {mention.extraction.revision}. Extraction{" "}
                    {mention.extraction.method} v{mention.extraction.version}.
                    Normalization {mention.extraction.normalizationVersion}.
                  </p>
                  <p className="import-source">
                    SHA-256 {mention.extraction.normalizedSourceHash}
                  </p>
                </details>
              </section>
            ))}
            <div className="import-actions">
              {job.mentions.length > 0 &&
                !active(job) &&
                job.reason?.code !== "cancelled" &&
                job.mentions.some((mention) => !mention.confirmation) && (
                  <button
                    type="button"
                    disabled={busy || !ready}
                    onClick={() =>
                      void mutate(`/api/imports/${job.id}/resolution`, {
                        action: "resolve",
                      })
                    }
                  >
                    {job.mentions.some((mention) => mention.resolution)
                      ? "Retry candidate lookup"
                      : "Find candidate branches"}
                  </button>
                )}
              {active(job) && (
                <button
                  type="button"
                  disabled={busy || !ready}
                  onClick={() =>
                    void mutate(`/api/imports/${job.id}`, { action: "cancel" })
                  }
                >
                  Cancel import
                </button>
              )}
              {job.reason?.retryable && job.attempt < 3 && !active(job) && (
                <button
                  type="button"
                  disabled={busy || !ready}
                  onClick={() =>
                    void mutate(`/api/imports/${job.id}`, { action: "retry" })
                  }
                >
                  Retry import
                </button>
              )}
              <button
                type="button"
                disabled={busy || !ready}
                onClick={() =>
                  void mutate(`/api/imports/${job.id}`, { action: "delete" })
                }
              >
                Delete temporary import
              </button>
            </div>
          </article>
        ))}
      </div>
      {resolvedPlaces.length > 0 && (
        <section
          aria-label="Confirmed temporary branches"
          className="import-attribution"
        >
          <h2>Confirmed temporary branches</h2>
          <p>
            Selections from your retained drafts, combined by branch identity.
            These are your choices; exact map pins remain unavailable.
          </p>
          {resolvedPlaces.map((resolved) => (
            <div key={`${resolved.dataKind}:${resolved.place.id}`}>
              <h3>
                {resolved.place.displayName} · {resolved.place.branch}
              </h3>
              <p>
                {resolved.place.address}. City: {resolved.place.city}
                {resolved.place.city !== "Shanghai"
                  ? " — outside Shanghai discovery"
                  : ""}
                .
              </p>
              <p>
                {resolved.importedEvidence.length} source mentions ·{" "}
                {resolved.dataKind === "fixture"
                  ? "Fictional development draft"
                  : "User-confirmed association"}
                .
              </p>
              {resolved.importedEvidence.map((evidence) => (
                <p key={`${evidence.importId}:${evidence.mentionId}`}>
                  <a
                    href={evidence.source.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original source
                  </a>{" "}
                  · {evidence.source.attribution}. Original wording: “
                  {evidence.extraction.quote}”. Your selection on{" "}
                  {evidence.confirmation.confirmedAt}; independent verification:
                  no.
                </p>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
