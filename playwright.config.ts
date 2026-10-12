import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8180",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run start -- --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      env: {
        ENABLE_DEVELOPMENT_FIXTURES: "1",
        BETTER_AUTH_URL: "http://127.0.0.1:8180",
        DATABASE_PATH: "./.data/test-shell.sqlite",
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
