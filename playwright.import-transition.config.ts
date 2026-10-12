import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "import-transition.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:8180", trace: "retain-on-failure" },
});
