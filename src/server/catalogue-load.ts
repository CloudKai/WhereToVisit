import { resolve } from "node:path";
import nextEnv from "@next/env";
import { loadCatalogueFile } from "./catalogue-publication";

nextEnv.loadEnvConfig(process.cwd());
try {
  loadCatalogueFile(resolve(process.argv[2] ?? "data/catalogue/shanghai.json"));
  console.log("Validated catalogue publication loaded atomically.");
} catch {
  console.error(
    "Catalogue load rejected. Check the source batch and database migrations; the previous publication was preserved.",
  );
  process.exitCode = 1;
}
