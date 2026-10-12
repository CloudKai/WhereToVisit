import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const value = readFileSync(".env.example", "utf8").replace(
  "REPLACE_WITH_A_HIGH_ENTROPY_LOCAL_SECRET",
  randomBytes(32).toString("base64url"),
);
writeFileSync(".env.local", value, { flag: "wx", mode: 0o600 });
console.log("Created .env.local with a private generated secret.");
