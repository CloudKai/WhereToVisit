import type { Metadata } from "next";
import Link from "next/link";
import { ExploreResults } from "@/components/explore-results";
import { SearchBox } from "@/components/search-box";
import { ConfigError } from "@/lib/config";
import { failureReason } from "@/lib/http";
import { exploreHref, parseDestination, parseFilter } from "@/lib/destination";
import { explore } from "@/lib/explore";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const destination = parseDestination(await searchParams);
  return {
    title: destination
      ? `Things to do and eat in ${destination.name} — WhereToVisit`
      : "Explore — WhereToVisit",
  };
}

function Problem({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="page-section problem" role="alert">
      <h1>{title}</h1>
      {children}
    </section>
  );
}

export default async function Explore({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const destination = parseDestination(params);
  const filter = parseFilter(params.type);

  if (!destination) {
    return (
      <section className="page-section">
        <h1>Choose a destination</h1>
        <p>That link is missing a valid destination. Search for one below.</p>
        <SearchBox autoFocus />
      </section>
    );
  }

  let result: Awaited<ReturnType<typeof explore>>;
  try {
    result = await explore(destination);
  } catch (error) {
    if (error instanceof ConfigError) {
      return (
        <Problem title="Setup needed">
          <p>
            This app needs the <code>{error.missing}</code> setting. Add it to{" "}
            <code>.env.local</code> and restart the server (see the README).
          </p>
        </Problem>
      );
    }
    console.warn(
      `[explore] failed: ${error instanceof Error ? error.message : "error"}`,
    );
    const reason = failureReason(error);
    if (reason === "key-rejected" || reason === "quota") {
      return (
        <Problem
          title={
            reason === "key-rejected"
              ? "The place-data key was rejected"
              : "Today’s place-data limit has been reached"
          }
        >
          <p>
            {reason === "key-rejected" ? (
              <>
                Geoapify refused the key in <code>GEOAPIFY_API_KEY</code>. Check
                that it is copied exactly (no quotes or spaces) and restart the
                server. In development, open <code>/api/status</code> to test
                it.
              </>
            ) : (
              <>The free daily allowance is used up. Try again tomorrow.</>
            )}
          </p>
        </Problem>
      );
    }
    return (
      <Problem title="We couldn’t load places right now">
        <p>
          The data services didn’t respond. This is usually temporary.{" "}
          <Link href={exploreHref(destination, filter)}>Try again</Link> or{" "}
          <Link href="/">search another destination</Link>.
        </p>
      </Problem>
    );
  }

  return (
    <ExploreResults
      destination={destination}
      editorPicks={result.editorPicks}
      nearby={result.nearby}
      notes={result.notes}
      aiUsed={result.aiUsed}
      initialFilter={filter}
    />
  );
}
