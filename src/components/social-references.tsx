"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SocialReference,
  socialReferenceInput,
} from "@/shared/social-reference";
import { textPolicies } from "@/shared/text-policy";
import { ReferenceBranchChoice } from "./reference-branch-choice";
import { TextField } from "./text-field";

export function SocialReferences({
  instagramPreviewOrigin = null,
}: {
  instagramPreviewOrigin?: string | null;
}) {
  const [references, setReferences] = useState<SocialReference[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const initialLoad = useRef(true);
  const entryDecided = useRef(false);
  const entryButton = useRef<HTMLButtonElement>(null);
  const savedDraft = useRef<HTMLElement>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const retained = useRef(false);
  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/social-references", {
        cache: "no-store",
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error?.message ?? "Could not load social drafts.",
        );
      if (retained.current && value.references.length === 0)
        setStatus(
          "A temporary social draft was removed or expired. Article imports are separate.",
        );
      if (initialLoad.current) {
        if (!entryDecided.current) setEntryOpen(value.references.length === 0);
        initialLoad.current = false;
      }
      setLoaded(true);
      setStale(false);
      setReferences(value.references);
      retained.current = value.references.length > 0;
      setNow(Date.now());
    } catch (failure) {
      setStale(true);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load social drafts. Retry explicitly.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const hide = () => setPreviewId(null);
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, []);
  useEffect(() => {
    const nextExpiry = Math.min(
      ...references.map((reference) => Date.parse(reference.expiresAt)),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(
      () => {
        const current = Date.now();
        setNow(current);
        setReferences((previous) =>
          previous.filter(
            (reference) => Date.parse(reference.expiresAt) > current,
          ),
        );
        setStatus(
          "A temporary social draft expired and is no longer available. Save the link again to start a new draft.",
        );
        void reload();
      },
      Math.max(0, nextExpiry - Date.now()) + 20,
    );
    return () => clearTimeout(timer);
  }, [references, reload]);
  useEffect(() => {
    if (savedId) savedDraft.current?.focus();
  }, [savedId]);
  function closeEntry() {
    entryDecided.current = true;
    setEntryOpen(false);
    entryButton.current?.focus();
  }
  function openEntry() {
    entryDecided.current = true;
    setEntryOpen(true);
    // Only a deliberate entry action moves focus; list updates never do.
    requestAnimationFrame(() =>
      document.getElementById("social-source")?.focus(),
    );
  }
  useEffect(() => {
    if (
      previewId &&
      !references.some(
        (reference) =>
          reference.id === previewId && Date.parse(reference.expiresAt) > now,
      )
    ) {
      setPreviewId(null);
    }
  }, [references, previewId, now]);
  let preview: ReturnType<typeof socialReferenceInput> | undefined;
  let validation = "";
  if (sourceUrl) {
    try {
      preview = socialReferenceInput(sourceUrl, note);
    } catch (failure) {
      validation =
        failure instanceof Error ? failure.message : "Check this reference.";
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");
    try {
      socialReferenceInput(sourceUrl, note);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Check this reference.",
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/social-references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl, note }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error?.message ?? "Could not save social draft.");
      setReferences((previous) => [value.reference, ...previous].slice(0, 20));
      retained.current = true;
      setNow(Date.now());
      setSourceUrl("");
      setNote("");
      setEntryOpen(false);
      setSavedId(value.reference.id);
      setStatus(
        value.normalized
          ? "Social draft saved. Query parameters and fragments were discarded; the saved URL is shown below."
          : "Social draft saved in this browser.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save social draft. Retry explicitly.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/social-references/${id}`, {
        method: "DELETE",
      });
      const value = await response.json();
      if (!response.ok && response.status !== 404)
        throw new Error(
          value.error?.message ?? "Could not delete social draft.",
        );
      setReferences((previous) =>
        previous.filter((reference) => reference.id !== id),
      );
      setStatus(
        response.status === 404
          ? "This social draft was already removed or expired."
          : "Social draft deleted, including your note.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete social draft. Retry explicitly.",
      );
    } finally {
      setBusy(false);
    }
  }
  const visible = references.filter(
    (reference) => Date.parse(reference.expiresAt) > now,
  );
  return (
    <div className="social-references" aria-busy={busy}>
      <p className="notice reference-privacy">
        Private to this browser, including on a shared device. Anyone using this
        browser can see these drafts.
      </p>
      <p className="reference-lifetime">
        Up to 20 drafts · 24 hours from creation · reads never extend expiry.
        Clearing the cookie or earlier session expiry ends access sooner.
      </p>
      <div className="reference-toolbar">
        <h2>
          Browser social drafts{" "}
          {loaded ? `(${visible.length}/20)` : "(not loaded)"}
        </h2>
        <div className="filter-actions">
          <button
            ref={entryButton}
            type="button"
            aria-expanded={entryOpen}
            aria-controls="social-entry"
            onClick={entryOpen ? closeEntry : openEntry}
          >
            {entryOpen ? "Close entry — keep inputs" : "Add a link"}
          </button>
          <button type="button" onClick={() => void reload()} disabled={busy}>
            Refresh social drafts
          </button>
        </div>
      </div>
      {error && (
        <p role="alert">
          {error} Use Refresh social drafts to retry loading, or retry your save
          or delete.
        </p>
      )}
      <p role="status" className="reference-status">
        {busy
          ? "Working on social drafts…"
          : stale
            ? loaded
              ? "Refresh failed. Showing previously loaded drafts; they may have changed. Retry Refresh social drafts."
              : "Drafts could not be loaded. Retry Refresh social drafts."
            : status ||
              (loaded
                ? `${visible.length} social drafts. Drafts are up to date.`
                : "Loading social drafts…")}
      </p>
      {loaded && !busy && !stale && visible.length === 0 && (
        <p className="reference-empty">
          No social drafts in this browser. Add a link for later.
        </p>
      )}
      {entryOpen && (
        <form
          id="social-entry"
          onSubmit={save}
          className="import-form reference-entry"
        >
          <h3>Add a social link</h3>
          <label htmlFor="social-source">Canonical social post URL</label>
          <input
            id="social-source"
            type="url"
            required
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            aria-describedby="social-url-help social-url-preview"
            autoComplete="off"
          />
          <p id="social-url-help">
            Use a www.xiaohongshu.com/explore/ post, www.tiktok.com/@name/video/
            post, or www.instagram.com/p/ or /reel/ post. Shortlinks, profiles,
            search pages and encoded paths are unsupported.
          </p>
          <p id="social-url-preview" aria-live="polite">
            {validation ||
              (preview
                ? `Will save: ${preview.sourceUrl}`
                : "Query parameters and fragments are discarded before storage. A stripped link may not remain available. We do not check its availability. Xiaohongshu may require the original sharing context.")}
          </p>
          {preview?.normalized && (
            <p>
              Query parameters and fragments will not be saved. The URL above is
              the reference you will keep; it may not remain available.
              Xiaohongshu may require the original sharing context.
            </p>
          )}
          <label htmlFor="social-note">
            Your note (optional, original words only)
          </label>
          <TextField
            id="social-note"
            policy={textPolicies.socialNote}
            value={note}
            onChange={setNote}
            autoComplete="off"
          />
          <p>
            Write your own reminder. Do not paste copied captions, reviews or
            other source text.
          </p>
          <button type="submit" disabled={busy || visible.length >= 20}>
            {busy ? "Working…" : "Keep social draft"}
          </button>
          <button type="button" onClick={closeEntry} disabled={busy}>
            Close entry — keep typed inputs
          </button>
        </form>
      )}
      <div className="social-reference-list">
        {visible.map((reference) => (
          <article
            key={reference.id}
            className="import-card social-reference-card"
            ref={reference.id === savedId ? savedDraft : undefined}
            tabIndex={-1}
            aria-label={`${reference.platform} draft`}
          >
            <h3>{reference.platform} reference</h3>
            <a
              href={reference.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              Open source on {reference.platform} (new tab)
            </a>
            <p className="social-source-url">{reference.sourceUrl}</p>
            {reference.note && (
              <>
                <h4>Your note</h4>
                <p className="social-note">{reference.note}</p>
              </>
            )}
            <p>
              Saved in app:{" "}
              <time dateTime={reference.createdAt}>
                {new Date(reference.createdAt).toLocaleString()}
              </time>
              . Expires:{" "}
              <time dateTime={reference.expiresAt}>
                {new Date(reference.expiresAt).toLocaleString()}
              </time>
              .
            </p>
            <ReferenceBranchChoice
              reference={reference}
              onChange={(updated) =>
                setReferences((previous) =>
                  previous.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                )
              }
            />
            {instagramPreviewOrigin && reference.platform === "Instagram" && (
              <div className="instagram-preview">
                <p>
                  Loading contacts Instagram with this public link and ordinary
                  browser and network information. Instagram may use its browser
                  storage. Your note and app session are not sent to the
                  preview.
                </p>
                <button
                  type="button"
                  aria-expanded={previewId === reference.id}
                  onClick={() =>
                    setPreviewId((current) =>
                      current === reference.id ? null : reference.id,
                    )
                  }
                >
                  {previewId === reference.id
                    ? "Hide preview"
                    : "Load Instagram preview"}
                </button>
                {previewId === reference.id && (
                  <>
                    <p role="status">
                      Preview requested; we cannot confirm whether the post is
                      visible. If it is blank, private, removed, unavailable or
                      asks you to sign in, use Open source above. Hide removes
                      this preview locally; it does not erase Instagram storage.
                    </p>
                    <iframe
                      title="Optional Instagram preview"
                      src={`${instagramPreviewOrigin}/display?source=${encodeURIComponent(reference.sourceUrl)}`}
                      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                      referrerPolicy="no-referrer"
                    />
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(reference.id)}
            >
              Delete {reference.platform} draft
            </button>
          </article>
        ))}
      </div>
      <details className="reference-help">
        <summary>About social links and draft storage</summary>
        <p>
          {instagramPreviewOrigin
            ? "Instagram previews are optional and load only when you choose. Other platforms remain links only. "
            : "No previews, embeds or source retrieval are enabled. "}
          These links do not extract places, confirm branches or enter discovery
          rankings. Publication date, verified creator, visits, current
          operation and social popularity are unknown. Delete a draft to erase
          its link and note.
        </p>
      </details>
    </div>
  );
}
