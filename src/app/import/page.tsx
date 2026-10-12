import { ContentImport } from "@/components/content-import";
export default function ImportPage() {
  return (
    <section className="page-section">
      <p className="eyebrow">YOUR INSPIRATION</p>
      <h1>Bring your inspiration</h1>
      <p className="lead">
        Keep the original wording. Review unresolved listing names.
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
