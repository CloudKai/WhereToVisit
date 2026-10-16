import Link from "next/link";
import { ContentImport } from "@/components/content-import";
export default function ImportPage() {
  return (
    <section className="page-section">
      <p className="eyebrow">YOUR INSPIRATION</p>
      <h1>Import an article</h1>
      <p className="lead">
        Find listing names, compare branches and keep the source.
      </p>
      <p>
        Have a social post?{" "}
        <Link href="/references">Keep a private temporary social link</Link>{" "}
        with your original note. This does not import its content.
      </p>
      <ContentImport
        fixtureMode={
          process.env.NODE_ENV === "development" &&
          process.env.ENABLE_DEVELOPMENT_IMPORT_FIXTURE === "1"
        }
      />
    </section>
  );
}
