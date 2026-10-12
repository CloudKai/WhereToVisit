import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { catalogueFixture } from "./tests/catalogue-fixture";

mkdirSync(".data", { recursive: true });
writeFileSync(
  ".data/catalogue-scenario.json",
  JSON.stringify(catalogueFixture()),
);
export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "catalogue.spec.ts",
    "discovery.spec.ts",
    "map-area.spec.ts",
    "import.spec.ts",
    "resolution.spec.ts",
  ],
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:8180",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run db:migrate && npm run dev -- --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      env: {
        ENABLE_DEVELOPMENT_MAP_FIXTURE: "1",
        ENABLE_DEVELOPMENT_IMPORT_FIXTURE: "1",
        IMPORTS_ENABLED: "1",
        DATABASE_PATH: `./.data/test-catalogue-${randomBytes(8).toString("hex")}.sqlite`,
        CATALOGUE_DEVELOPMENT_SOURCE: "./.data/catalogue-scenario.json",
        BETTER_AUTH_URL: "http://127.0.0.1:8180",
        BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
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
