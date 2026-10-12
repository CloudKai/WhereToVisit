import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());
export default defineConfig({
  schema: [
    "./src/server/db/auth-schema.ts",
    "./src/server/db/catalogue-schema.ts",
  ],
  out: "./drizzle",
  dialect: "sqlite",
});
