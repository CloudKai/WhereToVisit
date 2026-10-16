import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const id = randomBytes(8).toString("hex");
const databasePath = resolve(`.data/test-social-${id}.sqlite`);
const storageConfig = resolve(`.data/test-social-${id}.json`);
mkdirSync(".data", { recursive: true });
writeFileSync(storageConfig, JSON.stringify({ databasePath }));
process.env.WHERETOVISIT_SOCIAL_TEST_STORAGE_CONFIG = storageConfig;
process.env.WHERETOVISIT_SOCIAL_TEST_ORIGIN = "http://127.0.0.1:8180";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["social-references.spec.ts"],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8180",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "npm run db:migrate && npm run catalogue:load && npm run start -- --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      env: {
        DATABASE_PATH: databasePath,
        BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
        BETTER_AUTH_URL: "http://127.0.0.1:8180",
        IMPORTS_ENABLED: "1",
        WIKIMEDIA_OPERATOR_CONTACT: "",
        ENABLE_DEVELOPMENT_FIXTURES: "0",
        ENABLE_DEVELOPMENT_IMPORT_FIXTURE: "0",
        ENABLE_DEVELOPMENT_TRIP_FIXTURE: "0",
        ENABLE_DEVELOPMENT_MAP_FIXTURE: "0",
        ENABLE_DEVELOPMENT_DAY_PLAN_FIXTURE: "0",
        CATALOGUE_DEVELOPMENT_SOURCE: "",
      },
    },
    {
      command: "npm run nginx:serve -- --port 8180 --upstream 3100",
      url: "http://127.0.0.1:8180",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
  ],
});
