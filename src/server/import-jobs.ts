import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { developmentArticle } from "@/development/import-source";
import type { Import } from "@/shared/contracts";
import { getAuthConfiguration } from "./config";
import { openDatabase } from "./db/connection";
import { articleInput, ImportFailure } from "./import-policy";
import { extractListings } from "./wikivoyage-extraction";
import { retrieveArticle } from "./wikivoyage-fetch";

const DAY = 86400_000;
const SESSION_TTL = 30 * DAY;
export const SESSION_COOKIE = "wheretovisit-import-session";
type State = {
  running: Promise<void> | null;
  controllers: Map<string, AbortController>;
};
const global = globalThis as typeof globalThis & {
  whereToVisitImports?: State;
};
global.whereToVisitImports ??= { running: null, controllers: new Map() };
const state = global.whereToVisitImports;
function withDatabase<T>(
  operation: (db: ReturnType<typeof openDatabase>["sqlite"]) => T,
): T {
  const { sqlite } = openDatabase();
  try {
    return operation(sqlite);
  } finally {
    sqlite.close();
  }
}
function cleanup(db: ReturnType<typeof openDatabase>["sqlite"]) {
  const now = Date.now();
  db.prepare("DELETE FROM import_jobs WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM import_sessions WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM import_attempts WHERE created_at < ?").run(now - DAY);
  const stuck = db
    .prepare(
      "SELECT id, document FROM import_jobs WHERE (status='processing' AND updated_at < ?) OR (status='queued' AND created_at < ?)",
    )
    .all(now - 45_000, now - 120_000) as { id: string; document: string }[];
  for (const row of stuck) {
    const job: Import = JSON.parse(row.document);
    job.status = "failed";
    job.updatedAt = new Date(now).toISOString();
    job.reason = {
      code: "job-expired",
      message:
        "The bounded queue or processing deadline expired. Retry explicitly.",
      retryable: true,
    };
    db.prepare(
      "UPDATE import_jobs SET status='failed', updated_at=?, document=? WHERE id=?",
    ).run(now, JSON.stringify(job), row.id);
    state.controllers.get(row.id)?.abort();
  }
}
function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function importSession(token: string | undefined) {
  return withDatabase((db) => {
    cleanup(db);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const hash = digest(token);
      const row = db
        .prepare("SELECT expires_at FROM import_sessions WHERE digest=?")
        .get(hash) as { expires_at: number } | undefined;
      if (row) return { digest: hash, token: null, expiresAt: row.expires_at };
    }
    const sessionCount = Number(
      (
        db.prepare("SELECT COUNT(*) AS count FROM import_sessions").get() as {
          count: number;
        }
      ).count,
    );
    if (sessionCount >= 10_000)
      throw new ImportFailure(
        "storage-full",
        "Temporary session capacity reached. Retry later.",
        true,
      );
    const fresh = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_TTL;
    db.prepare(
      "INSERT INTO import_sessions(digest,expires_at) VALUES(?,?)",
    ).run(digest(fresh), expiresAt);
    return { digest: digest(fresh), token: fresh, expiresAt };
  });
}
export function listImports(session: string) {
  return withDatabase((db) => {
    cleanup(db);
    const rows = db
      .prepare(
        "SELECT document FROM import_jobs WHERE session_digest=? ORDER BY created_at DESC LIMIT 20",
      )
      .all(session) as { document: string }[];
    return rows.map((row) => ({
      ...(JSON.parse(row.document) as Import),
      sourceReplayAvailable: false,
    }));
  });
}
export function getImport(session: string, id: string) {
  return withDatabase((db) => {
    cleanup(db);
    const row = db
      .prepare(
        "SELECT document FROM import_jobs WHERE id=? AND session_digest=?",
      )
      .get(id, session) as { document: string } | undefined;
    return row
      ? {
          ...(JSON.parse(row.document) as Import),
          sourceReplayAvailable: false,
        }
      : null;
  });
}
function consumeAttempt(
  db: ReturnType<typeof openDatabase>["sqlite"],
  session: string,
  ip: string,
) {
  const now = Date.now();
  const ipDigest = createHmac("sha256", getAuthConfiguration().secret)
    .update(ip)
    .digest("hex");
  const count = (where: string, ...params: (number | string)[]) =>
    Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM import_attempts WHERE ${where}`,
          )
          .get(...params) as { count: number }
      ).count,
    );
  if (
    count("session_digest=? AND created_at>?", session, now - 60_000) >= 5 ||
    count("session_digest=?", session) >= 20 ||
    count("ip_digest=? AND created_at>?", ipDigest, now - 60_000) >= 40 ||
    count("ip_digest=?", ipDigest) >= 200 ||
    count("created_at>?", now - 60_000) >= 60 ||
    count("1=1") >= 1000
  )
    throw new ImportFailure(
      "rate-limited",
      "Anonymous import limits reached. Wait before retrying.",
      true,
    );
  db.prepare(
    "INSERT INTO import_attempts(session_digest,ip_digest,created_at) VALUES(?,?,?)",
  ).run(session, ipDigest, now);
}
function capacity(
  db: ReturnType<typeof openDatabase>["sqlite"],
  session: string,
  addingJob = true,
) {
  const count = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM import_jobs WHERE status IN ('queued','processing')",
        )
        .get() as { count: number }
    ).count,
  );
  const own = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM import_jobs WHERE session_digest=? AND status IN ('queued','processing')",
        )
        .get(session) as { count: number }
    ).count,
  );
  const queued = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM import_jobs WHERE session_digest=? AND status='queued'",
        )
        .get(session) as { count: number }
    ).count,
  );
  if (count >= 100 || own >= 3 || queued >= 2)
    throw new ImportFailure(
      "queue-full",
      "The bounded import queue is full. Wait for an existing import or cancel it.",
      true,
    );
  const retainedBySession = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM import_jobs WHERE session_digest=?",
        )
        .get(session) as { count: number }
    ).count,
  );
  if (addingJob && retainedBySession >= 20)
    throw new ImportFailure(
      "storage-full",
      "This session already retains twenty temporary drafts. Delete a draft before importing another article.",
      true,
    );
  const retained = Number(
    (
      db.prepare("SELECT COUNT(*) AS count FROM import_jobs").get() as {
        count: number;
      }
    ).count,
  );
  if (addingJob && retained >= 1000)
    throw new ImportFailure(
      "storage-full",
      "Temporary import storage is full. Delete a draft or retry later.",
      true,
    );
}
export function createImport(session: string, ip: string, sourceUrl: string) {
  return withDatabase((db) =>
    db.transaction(() => {
      cleanup(db);
      consumeAttempt(db, session, ip);
      let validated: ReturnType<typeof articleInput> | null = null;
      let failure: ImportFailure | null = null;
      try {
        validated = articleInput(sourceUrl);
      } catch (error) {
        if (error instanceof ImportFailure) failure = error;
        else throw error;
      }
      const sourceKey =
        validated?.canonicalUrl ??
        `rejected:${createHmac("sha256", getAuthConfiguration().secret).update(sourceUrl).digest("hex")}`;
      const existing = db
        .prepare(
          "SELECT document FROM import_jobs WHERE session_digest=? AND source_key=? ORDER BY created_at DESC LIMIT 1",
        )
        .get(session, sourceKey) as { document: string } | undefined;
      if (existing)
        return {
          ...(JSON.parse(existing.document) as Import),
          sourceReplayAvailable: false,
        };
      capacity(db, session);
      const now = Date.now();
      const expiresAt = (
        db
          .prepare("SELECT expires_at FROM import_sessions WHERE digest=?")
          .get(session) as { expires_at: number }
      ).expires_at;
      const job: Import = {
        dataKind: "real",
        id: randomBytes(18).toString("base64url"),
        sourceUrl: failure
          ? "Rejected URL (unsupported or unsafe input)"
          : (validated?.canonicalUrl ?? sourceUrl),
        city: "Shanghai",
        owner: { kind: "visitor" },
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        status: failure
          ? failure.unsupported
            ? "unsupported"
            : "failed"
          : "queued",
        reason: failure
          ? {
              code: failure.code,
              message: failure.message,
              retryable: failure.retryable,
            }
          : null,
        mentions: [],
        attempt: 1,
        expiresAt: new Date(expiresAt).toISOString(),
        partial: false,
        sourceReplayAvailable: false,
        evidence: null,
      };
      db.prepare(
        "INSERT INTO import_jobs(id,session_digest,source_key,status,created_at,updated_at,expires_at,document) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        job.id,
        session,
        sourceKey,
        job.status,
        now,
        now,
        expiresAt,
        JSON.stringify(job),
      );
      return job;
    })(),
  );
}
export function mutateImport(
  session: string,
  ip: string,
  id: string,
  action: "retry" | "cancel" | "delete",
) {
  return withDatabase((db) =>
    db.transaction(() => {
      cleanup(db);
      const row = db
        .prepare(
          "SELECT document FROM import_jobs WHERE id=? AND session_digest=?",
        )
        .get(id, session) as { document: string } | undefined;
      if (!row) return null;
      const job: Import = JSON.parse(row.document);
      if (action === "delete") {
        state.controllers.get(id)?.abort();
        db.prepare(
          "DELETE FROM import_jobs WHERE id=? AND session_digest=?",
        ).run(id, session);
        return { deleted: true };
      }
      if (action === "cancel") {
        if (job.status !== "queued" && job.status !== "processing") return job;
        state.controllers.get(id)?.abort();
        job.status = "completed";
        job.reason = {
          code: "cancelled",
          message: "Import cancelled. No places were created.",
          retryable: false,
        };
      } else {
        if (job.status === "queued" || job.status === "processing") return job;
        if (!job.reason?.retryable || job.attempt >= 3)
          throw new ImportFailure(
            "retry-unavailable",
            "This outcome cannot be retried, or its three-attempt limit has been reached.",
          );
        consumeAttempt(db, session, ip);
        capacity(db, session, false);
        const backoff = (
          db
            .prepare(
              "SELECT backoff_until FROM import_provider_state WHERE id=1",
            )
            .get() as { backoff_until: number }
        ).backoff_until;
        if (backoff > Date.now())
          throw new ImportFailure(
            "rate-limited",
            "Source backoff is still active. Wait before retrying.",
            true,
          );
        job.attempt++;
        job.status = "queued";
        job.reason = null;
        // Reset the queue clock on an explicit retry, retaining identity and original creation time in the document.
        db.prepare("UPDATE import_jobs SET created_at=? WHERE id=?").run(
          Date.now(),
          id,
        );
      }
      job.updatedAt = new Date().toISOString();
      job.mentions = [];
      job.evidence = null;
      job.partial = false;
      job.sourceReplayAvailable = false;
      db.prepare(
        "UPDATE import_jobs SET status=?,updated_at=?,document=? WHERE id=? AND session_digest=?",
      ).run(job.status, Date.now(), JSON.stringify(job), id, session);
      return job;
    })(),
  );
}
async function worker() {
  for (let processed = 0; processed < 3; processed++) {
    const job = withDatabase((db) =>
      db.transaction(() => {
        cleanup(db);
        if (process.env.IMPORTS_ENABLED !== "1") {
          const rows = db
            .prepare(
              "SELECT id,document FROM import_jobs WHERE status='queued'",
            )
            .all() as { id: string; document: string }[];
          for (const row of rows) {
            const paused: Import = JSON.parse(row.document);
            paused.status = "unsupported";
            paused.reason = {
              code: "integration-disabled",
              message: "Article imports are disabled by the operator.",
              retryable: false,
            };
            db.prepare(
              "UPDATE import_jobs SET status='unsupported',document=? WHERE id=?",
            ).run(JSON.stringify(paused), row.id);
          }
          return null;
        }
        // Persisted claim enforces one serial fetch stream across route bundles/process restarts.
        if (
          db
            .prepare(
              "SELECT id FROM import_jobs WHERE status='processing' LIMIT 1",
            )
            .get()
        )
          return null;
        const row = db
          .prepare(
            "SELECT document FROM import_jobs WHERE status='queued' ORDER BY created_at LIMIT 1",
          )
          .get() as { document: string } | undefined;
        if (!row) return null;
        const pending: Import = JSON.parse(row.document);
        const backoff = (
          db
            .prepare(
              "SELECT backoff_until FROM import_provider_state WHERE id=1",
            )
            .get() as { backoff_until: number }
        ).backoff_until;
        if (backoff > Date.now()) return null;
        pending.status = "processing";
        pending.updatedAt = new Date().toISOString();
        db.prepare(
          "UPDATE import_jobs SET status='processing', updated_at=?,document=? WHERE id=? AND status='queued'",
        ).run(Date.now(), JSON.stringify(pending), pending.id);
        return pending;
      })(),
    );
    if (!job) return;
    const controller = new AbortController();
    state.controllers.set(job.id, controller);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(45_000),
    ]);
    try {
      const input = articleInput(job.sourceUrl);
      const source =
        (await developmentArticle(input.title, signal)) ??
        (await retrieveArticle(input.title, signal));
      const result = extractListings(
        job.id,
        job.sourceUrl,
        input.canonicalUrl,
        source,
      );
      job.dataKind = source.dataKind;
      job.mentions = result.mentions;
      job.evidence = result.evidence;
      job.partial = result.partial;
      job.sourceReplayAvailable = false;
      job.status = result.mentions.length
        ? "awaiting-confirmation"
        : "completed";
      job.reason = result.mentions.length
        ? null
        : {
            code: "no-place",
            message:
              "Supported Eat/Drink sections contained no explicit listing names. Other source content was not analysed.",
            retryable: false,
          };
    } catch (error) {
      const failure =
        error instanceof ImportFailure
          ? error
          : new ImportFailure(
              "extraction-incomplete",
              "Reliable extraction did not complete.",
              true,
            );
      job.status = failure.unsupported ? "unsupported" : "failed";
      job.reason = {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      };
      if (failure.backoffSeconds)
        withDatabase((db) =>
          db
            .prepare(
              "UPDATE import_provider_state SET backoff_until=MAX(backoff_until,?) WHERE id=1",
            )
            .run(Date.now() + failure.backoffSeconds * 1000),
        );
    } finally {
      state.controllers.delete(job.id);
    }
    job.updatedAt = new Date().toISOString();
    // Exact quote/hash/span validation happened in memory. Full source is erased here, never persisted.
    withDatabase((db) =>
      db
        .prepare(
          "UPDATE import_jobs SET status=?, updated_at=?, document=? WHERE id=? AND status='processing' AND json_extract(document, '$.attempt')=?",
        )
        .run(job.status, Date.now(), JSON.stringify(job), job.id, job.attempt),
    );
  }
}
export function runImportQueue() {
  state.running ??= worker().finally(() => {
    state.running = null;
  });
  return state.running;
}
