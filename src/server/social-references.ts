import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import {
  type ReferenceBranch,
  type SocialReference,
  socialReferenceInput,
  socialReferenceLimits,
} from "@/shared/social-reference";
import { validateCatalogueBatch } from "./catalogue-validation";
import { getAuthConfiguration } from "./config";
import { openDatabase } from "./db/connection";

export class ReferenceFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
type Sqlite = ReturnType<typeof openDatabase>["sqlite"];
function storage<T>(operation: (db: Sqlite, now: number) => T): T {
  const { sqlite } = openDatabase();
  try {
    return sqlite.transaction(() => {
      const now = Date.now();
      // Expired data is excluded independently of this bounded physical cleanup.
      sqlite
        .prepare(
          "DELETE FROM social_references WHERE id IN (SELECT id FROM social_references WHERE expires_at<=? ORDER BY expires_at LIMIT 100)",
        )
        .run(now);
      sqlite
        .prepare(
          "DELETE FROM social_reference_attempts WHERE rowid IN (SELECT rowid FROM social_reference_attempts WHERE created_at<=? ORDER BY created_at LIMIT 100)",
        )
        .run(now - 60_000);
      return operation(sqlite, now);
    })();
  } finally {
    sqlite.close();
  }
}
const projection =
  "id, platform, source_url AS sourceUrl, note, created_at AS createdAt, expires_at AS expiresAt, branch_id AS branchId, choice_revision AS choiceRevision";
type Row = Omit<SocialReference, "createdAt" | "expiresAt" | "branchChoice"> & {
  branchId: string | null;
  createdAt: number;
  expiresAt: number;
};
function branches(db: Sqlite): ReferenceBranch[] | null {
  try {
    const row = db
      .prepare(
        "SELECT payload FROM catalogue_publication WHERE city='Shanghai'",
      )
      .get() as { payload: string } | undefined;
    if (!row) return null;
    const batch = validateCatalogueBatch(JSON.parse(row.payload));
    if (batch.kind !== "real" || batch.status !== "published") return null;
    return batch.places
      .filter((place) => place.city === "Shanghai")
      .map((place) => ({
        id: place.id,
        displayName: place.displayName,
        address: place.address,
        sources: place.evidence.map(({ sourceUrl, capturedAt, limits }) => ({
          sourceUrl,
          capturedAt,
          limits,
        })),
      }));
  } catch {
    return null;
  }
}
export function referenceBranches() {
  return storage((db) => {
    const candidates = branches(db);
    if (!candidates)
      throw new ReferenceFailure(
        "catalogue-unavailable",
        "The real Shanghai catalogue is unavailable. Keep this reference unresolved and retry later.",
        503,
      );
    return candidates;
  });
}
function project(row: Row, db: Sqlite): SocialReference {
  const { branchId, ...retained } = row;
  return {
    ...retained,
    branchChoice: branchId
      ? {
          branchId,
          branch:
            branches(db)?.find((branch) => branch.id === branchId) ?? null,
        }
      : null,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}
const live =
  "session_digest=? AND expires_at>? AND EXISTS (SELECT 1 FROM import_sessions s WHERE s.digest=social_references.session_digest AND s.expires_at>?)";
export function listReferences(session: string) {
  return storage((db, now) =>
    (
      db
        .prepare(
          `SELECT ${projection} FROM social_references WHERE ${live} ORDER BY created_at DESC, id LIMIT 20`,
        )
        .all(session, now, now) as Row[]
    ).map((row) => project(row, db)),
  );
}
export function readReference(session: string, id: string, remove = false) {
  return storage((db, now) => {
    const row = db
      .prepare(
        `SELECT ${projection} FROM social_references WHERE id=? AND ${live}`,
      )
      .get(id, session, now, now) as Row | undefined;
    if (!row) return null;
    if (remove)
      db.prepare(
        "DELETE FROM social_references WHERE id=? AND session_digest=?",
      ).run(id, session);
    return project(row, db);
  });
}
export function createReference(
  session: string,
  ip: string,
  input: Record<string, unknown>,
) {
  if (Object.keys(input).some((key) => !["sourceUrl", "note"].includes(key)))
    throw new ReferenceFailure(
      "invalid-request",
      "Supply only sourceUrl and an optional original note.",
    );
  let parsed: ReturnType<typeof socialReferenceInput>;
  try {
    parsed = socialReferenceInput(input.sourceUrl, input.note);
  } catch (error) {
    throw new ReferenceFailure(
      "invalid-input",
      error instanceof Error ? error.message : "Invalid reference.",
    );
  }
  return storage((db, now) => {
    const owner = db
      .prepare(
        "SELECT expires_at FROM import_sessions WHERE digest=? AND expires_at>?",
      )
      .get(session, now) as { expires_at: number } | undefined;
    if (!owner)
      throw new ReferenceFailure(
        "session-expired",
        "This browser session expired. Reload to start a new draft.",
        409,
      );
    const count = (sql: string, ...params: (string | number)[]) =>
      (db.prepare(sql).get(...params) as { count: number }).count;
    if (
      count(
        "SELECT COUNT(*) AS count FROM social_references WHERE session_digest=? AND expires_at>?",
        session,
        now,
      ) >= socialReferenceLimits.drafts
    )
      throw new ReferenceFailure(
        "draft-limit",
        "This browser already has 20 live social drafts. Delete one before saving another.",
        409,
      );
    if (count("SELECT COUNT(*) AS count FROM social_references") >= 20_000)
      throw new ReferenceFailure(
        "storage-full",
        "Temporary reference capacity reached. Retry later.",
        503,
      );
    const ipDigest = createHmac("sha256", getAuthConfiguration().secret)
      .update(ip)
      .digest("hex");
    if (
      count(
        "SELECT COUNT(*) AS count FROM social_reference_attempts WHERE session_digest=? AND created_at>?",
        session,
        now - 60_000,
      ) >= 40 ||
      count(
        "SELECT COUNT(*) AS count FROM social_reference_attempts WHERE ip_digest=? AND created_at>?",
        ipDigest,
        now - 60_000,
      ) >= 200 ||
      count("SELECT COUNT(*) AS count FROM social_reference_attempts") >= 1000
    )
      throw new ReferenceFailure(
        "rate-limited",
        "Social reference limits reached. Wait a minute before retrying.",
        429,
      );
    const id = randomUUID();
    const expiresAt = Math.min(
      now + socialReferenceLimits.lifetimeMs,
      owner.expires_at,
    );
    db.prepare(
      "INSERT INTO social_references(id, session_digest, platform, source_url, note, created_at, expires_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      session,
      parsed.platform,
      parsed.sourceUrl,
      parsed.note,
      now,
      expiresAt,
    );
    db.prepare(
      "INSERT INTO social_reference_attempts(session_digest,ip_digest,created_at) VALUES(?,?,?)",
    ).run(session, ipDigest, now);
    return {
      reference: project(
        {
          id,
          platform: parsed.platform,
          sourceUrl: parsed.sourceUrl,
          note: parsed.note,
          createdAt: now,
          expiresAt,
          branchId: null,
          choiceRevision: 0,
        },
        db,
      ),
      normalized: parsed.normalized,
    };
  });
}

export function chooseReferenceBranch(
  session: string,
  ip: string,
  id: string,
  input: Record<string, unknown>,
) {
  return storage((db, now) => {
    const row = db
      .prepare(
        `SELECT ${projection} FROM social_references WHERE id=? AND ${live}`,
      )
      .get(id, session, now, now) as Row | undefined;
    if (!row) return null;
    if (
      Object.keys(input).some(
        (key) => !["branchId", "expectedRevision"].includes(key),
      ) ||
      !(
        input.branchId === null ||
        (typeof input.branchId === "string" &&
          /^[a-zA-Z0-9_-]{1,160}$/.test(input.branchId))
      ) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      (input.expectedRevision as number) < 0
    )
      throw new ReferenceFailure(
        "invalid-choice",
        "Supply only a canonical branchId (or null to clear) and expectedRevision.",
      );
    if (input.expectedRevision !== row.choiceRevision)
      throw new ReferenceFailure(
        "stale-choice",
        "This choice changed in another view. Refresh social drafts, then review your choice again.",
        409,
      );
    const ipDigest = createHmac("sha256", getAuthConfiguration().secret)
      .update(ip)
      .digest("hex");
    const count = (sql: string, ...params: (string | number)[]) =>
      (db.prepare(sql).get(...params) as { count: number }).count;
    if (
      count(
        "SELECT COUNT(*) AS count FROM social_reference_attempts WHERE session_digest=? AND created_at>?",
        session,
        now - 60_000,
      ) >= 40 ||
      count(
        "SELECT COUNT(*) AS count FROM social_reference_attempts WHERE ip_digest=? AND created_at>?",
        ipDigest,
        now - 60_000,
      ) >= 200 ||
      count("SELECT COUNT(*) AS count FROM social_reference_attempts") >= 1000
    )
      throw new ReferenceFailure(
        "rate-limited",
        "Social reference limits reached. Wait a minute before retrying.",
        429,
      );
    if (input.branchId !== null) {
      const candidates = branches(db);
      if (!candidates)
        throw new ReferenceFailure(
          "catalogue-unavailable",
          "The real Shanghai catalogue is unavailable. Your previous choice is unchanged; retry later.",
          503,
        );
      if (!candidates.some((branch) => branch.id === input.branchId))
        throw new ReferenceFailure(
          "branch-unavailable",
          "Choose a currently published real Shanghai branch. This limited catalogue may not contain your branch.",
          400,
        );
    }
    db.prepare(
      "UPDATE social_references SET branch_id=?, choice_revision=choice_revision+1 WHERE id=?",
    ).run(input.branchId, id);
    db.prepare(
      "INSERT INTO social_reference_attempts(session_digest,ip_digest,created_at) VALUES(?,?,?)",
    ).run(session, ipDigest, now);
    return project(
      {
        ...row,
        branchId: input.branchId as string | null,
        choiceRevision: row.choiceRevision + 1,
      },
      db,
    );
  });
}
