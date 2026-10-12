import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./auth-schema";
/** Called at runtime only; importing this module never opens a database. */
export function openDatabase() {
  const configured = process.env.DATABASE_PATH;
  if (!configured || configured === ":memory:")
    throw new Error("Set DATABASE_PATH to a durable local file.");
  const filename = resolve(configured);
  mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
