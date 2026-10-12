import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "shell.spec.ts",
    "trips-production.spec.ts",
    "invitations-production.spec.ts",
    "day-plans-production.spec.ts",
    "day-generation-production.spec.ts",
    "day-editing-production.spec.ts",
  ],
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
        ENABLE_DEVELOPMENT_FIXTURES: "1",
        ENABLE_DEVELOPMENT_DAY_PLAN_FIXTURE: "1",
        DAY_PLAN_DEVELOPMENT_SOURCE: "./.data/day-planning-scenario.json",
        ENABLE_DEVELOPMENT_MAP_FIXTURE: "1",
        ENABLE_DEVELOPMENT_IMPORT_FIXTURE: "1",
        ENABLE_DEVELOPMENT_TRIP_FIXTURE: "1",
        IMPORTS_ENABLED: "1",
        WIKIMEDIA_OPERATOR_CONTACT: "",
        CATALOGUE_DEVELOPMENT_SOURCE: "./.data/catalogue-scenario.json",
        BETTER_AUTH_URL: "http://127.0.0.1:8180",
        DATABASE_PATH: `./.data/test-shell-${randomBytes(8).toString("hex")}.sqlite`,
        BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
      },
    },
    {
      command: "npm run nginx:serve -- --port 8180 --upstream 3100",
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
      url: "http://127.0.0.1:8180",
      reuseExistingServer: false,
    },
  ],
});
