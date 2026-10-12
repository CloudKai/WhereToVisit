import "server-only";
import { ImportFailure } from "@/server/import-policy";
import {
  validateSourceHeaders,
  validateSourcePayload,
  type WikiSource,
} from "@/server/wikivoyage-fetch";
/** Authored boundary fixtures. Never called outside explicit development mode. */
export async function developmentArticle(
  title: string,
  signal: AbortSignal,
): Promise<WikiSource | null> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ENABLE_DEVELOPMENT_IMPORT_FIXTURE !== "1" ||
    !title.startsWith("Fixture ")
  )
    return null;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, title === "Fixture Slow" ? 3000 : 250);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ImportFailure("cancelled", "Import cancelled."));
      },
      { once: true },
    );
  });
  if (title === "Fixture Unavailable")
    throw new ImportFailure(
      "source-unavailable",
      "Authored fixture: source unavailable, cause unknown.",
    );
  if (title === "Fixture Private")
    throw new ImportFailure(
      "private-or-auth-required",
      "Authored fixture: explicit access denial.",
      false,
      true,
    );
  if (title === "Fixture Redirect")
    validateSourceHeaders(302, { location: "http://127.0.0.1/private" });
  if (title === "Fixture Retry" && !retrySeen.has(title)) {
    retrySeen.add(title);
    throw new ImportFailure(
      "network-unavailable",
      "Authored fixture: temporary network failure.",
      true,
    );
  }
  let wikitext =
    "== Eat ==\n* {{eat|name= Café 🥟 One |url=}}\n== Drink ==\n* {{drink|name=Tea Two}}";
  if (title === "Fixture Empty") wikitext = "== Eat ==\n\n== Drink ==\n";
  if (title === "Fixture Prose")
    wikitext = "== Eat ==\nSome restaurants are described here.";
  if (title === "Fixture Nested")
    wikitext =
      "== Eat ==\n{{eat|name=Plain Name}}\n{{eat|name={{lang|zh|嵌套}}}}\nUnanalysed prose.";
  if (title === "Fixture WrongRevision")
    return validateSourcePayload(
      title,
      JSON.stringify({ parse: { title, revid: "not-a-revision", wikitext } }),
    );
  validateSourceHeaders(200, { "content-type": "application/json" });
  return {
    ...validateSourcePayload(
      title,
      JSON.stringify({ parse: { title, revid: 12345, wikitext } }),
    ),
    dataKind: "fixture",
  };
}
const retrySeen = new Set<string>();
