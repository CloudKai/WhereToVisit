"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Import } from "@/shared/contracts";

const active = (job: Import) =>
  job.status === "queued" || job.status === "processing";
export function ContentImport({ fixtureMode }: { fixtureMode: boolean }) {
  const [url, setUrl] = useState("");
  const [jobs, setJobs] = useState<Import[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const mutating = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (mutating.current && !force) return;
    const current = ++generation.current;
    try {
      const response = await fetch("/api/imports", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error?.message ?? "Drafts could not be loaded.");
      if (current === generation.current) {
        setJobs(value.jobs);
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
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 1500);
    return () => {
      clearInterval(interval);
      generation.current++;
    };
  }, [refresh]);
  async function mutate(path: string, body: object) {
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
      <p>
        Supported: public English Wikivoyage articles with explicit Eat/Drink
        listing names. Social links, videos, other blogs and general prose
        analysis are unavailable.
      </p>
      <p>
        Temporary drafts belong to this browser session and expire within 30
        days. Source text is deleted immediately after extraction. These names
        are unresolved; matching, map pins, accounts and Trip saving are
        unavailable.
      </p>
      {fixtureMode && (
        <p className="map-fixture-label">
          Fictional import responses — development behavior only
        </p>
      )}
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
      {(error || fetchError) && (
        <div role="alert">
          <p>{error ?? fetchError}</p>
          <button type="button" onClick={() => void refresh()}>
            Reload drafts
          </button>
        </div>
      )}
      <div aria-live="polite" aria-atomic="false">
        {!jobs.length && <p>No temporary imports in this browser session.</p>}
        {jobs.map((job) => (
          <article className="import-job" key={job.id}>
            <h2>Article import</h2>
            {job.dataKind === "fixture" && (
              <p>Fictional source result — development only</p>
            )}
            <p className="import-source">{job.sourceUrl}</p>
            <p role="status">
              {job.status === "queued"
                ? "Queued — waiting for the bounded source worker"
                : job.status === "processing"
                  ? "Processing — retrieving article and extracting listing names"
                  : job.status === "awaiting-confirmation"
                    ? "Extracted names — location resolution unavailable"
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
              </div>
            )}
            {job.mentions.map((mention) => (
              <section className="import-mention" key={mention.id}>
                <h3>{mention.originalText}</h3>
                <p>Unresolved mention</p>
                <p>
                  Selected city: Shanghai (your import scope; not a source
                  location fact). Branch and address unknown.
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
    </div>
  );
}
