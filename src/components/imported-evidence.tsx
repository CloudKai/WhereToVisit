import type { SharedGuestTrip } from "@/shared/contracts";

type SharedImportedEvidence =
  SharedGuestTrip["trip"]["savedPlaces"][number]["importedEvidence"][number];
/** Read-only licensed source facts shared by private and guest Trip views. */
export function ImportedEvidence({
  evidence,
}: {
  evidence: SharedImportedEvidence;
}) {
  return (
    <>
      <p>Original wording: “{evidence.extraction.quote}”</p>
      <p>User-selected branch; independent verification: no.</p>
      <p>
        <a href={evidence.source.canonicalUrl} target="_blank" rel="noreferrer">
          Original article
        </a>{" "}
        · revision {evidence.source.revision}
      </p>
      <p>
        {evidence.source.attribution} ·{" "}
        <a href={evidence.source.licenseUrl} target="_blank" rel="noreferrer">
          {evidence.source.license}
        </a>
      </p>
      <p>{evidence.source.changes}</p>
      {evidence.source.historyUrl && (
        <a href={evidence.source.historyUrl} target="_blank" rel="noreferrer">
          Contributor history
        </a>
      )}
      {evidence.source.revisionUrl && (
        <p>
          <a
            href={evidence.source.revisionUrl}
            target="_blank"
            rel="noreferrer"
          >
            Exact source revision
          </a>
        </p>
      )}
      <p>{evidence.source.limits}</p>
    </>
  );
}
