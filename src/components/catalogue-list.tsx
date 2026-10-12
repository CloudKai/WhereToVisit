import type { CatalogueResult } from "@/shared/contracts";

const sourceFactLabels = {
  identity: "branch name and address",
  category: "food or café category",
  neighbourhood: "area",
  operation: "operating status",
  price: "price",
  hours: "opening hours",
  rating: "provider rating",
  classification: "recommendation type",
};
const sourceStatusLabels = {
  current: "page checked",
  historical: "historical evidence",
  unverified: "not confirmed",
};
const classificationLabels = {
  trending: "Trending",
  "local-favourite": "Local favourite",
  "highly-reviewed": "Highly reviewed",
};
export function CatalogueList({ catalogue }: { catalogue: CatalogueResult }) {
  return (
    <>
      <p role="status">{catalogue.coverageMessage}</p>
      {catalogue.dataKind === "fixture" && (
        <p className="fixture-notice">
          Fictional scenario data — not real venues or provider verification.
        </p>
      )}
      <div className="catalogue-list">
        {catalogue.places.map((place) => (
          <article key={place.id} className="catalogue-place">
            <h2>{place.displayName}</h2>
            <p>
              {place.localName} · {place.branch}
            </p>
            <p>
              {place.address}
              <br />
              {place.neighbourhood} ·{" "}
              {place.category === "cafe" ? "Café" : "Food"}
            </p>
            <p>
              {place.operationStatus === "unknown"
                ? "Operating status unconfirmed"
                : place.operationStatus === "current"
                  ? "Venue reports current operation"
                  : "Venue reported closed"}
              .{" "}
              {place.price
                ? `${place.price.currency} ${place.price.amount}`
                : "Price unknown"}
              . {place.hours ? place.hours.description : "Hours unknown"}.{" "}
              {place.rating
                ? `${place.rating.provider}: ${place.rating.value}/${place.rating.scale}`
                : "Rating unknown"}
              .
            </p>
            <details>
              <summary>Sources and place details</summary>
              {[
                ["Price", place.price?.sourceEvidenceId],
                ["Hours", place.hours?.sourceEvidenceId],
                ["Rating", place.rating?.sourceEvidenceId],
              ].map(([label, id]) => {
                const source = place.evidence.find((item) => item.id === id);
                return source ? (
                  <p key={label}>
                    {label} source:{" "}
                    <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                      {source.attribution}
                    </a>
                    , {source.capturedAt.slice(0, 10)}
                  </p>
                ) : null;
              })}
              {place.rating && (
                <p>
                  Rating observed: {place.rating.observedAt.slice(0, 10)}.
                  Review count {place.rating.count ?? "unknown"}.
                </p>
              )}
              <p>
                {place.classifications.length
                  ? place.classifications
                      .map(
                        (item) =>
                          `${classificationLabels[item.type]}: ${item.reason} (rule: ${item.rule}, ${item.ruleDate.slice(0, 10)})`,
                      )
                      .join("; ")
                  : "Unclassified — no evidenced recommendation type assigned."}
              </p>
              <ul>
                {place.evidence.map((evidence) => (
                  <li key={evidence.id}>
                    {evidence.recommendation && (
                      <p>
                        {evidence.recommendation.summary} —{" "}
                        {evidence.recommendation.mentionedExperience}
                      </p>
                    )}
                    <a
                      href={evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {evidence.attribution}
                    </a>{" "}
                    · observed{" "}
                    <time dateTime={evidence.capturedAt}>
                      {evidence.capturedAt.slice(0, 10)}
                    </time>{" "}
                    · {sourceStatusLabels[evidence.status]}
                    {evidence.publishedAt
                      ? ` · published ${evidence.publishedAt.slice(0, 10)}`
                      : " · publication date unknown"}
                    <p>
                      Source supports:{" "}
                      {evidence.establishedFacts
                        .map((fact) => sourceFactLabels[fact])
                        .join(", ")}
                      . {evidence.limits}
                    </p>
                  </li>
                ))}
              </ul>
              <ul>
                {place.providerReferences.map((reference) => (
                  <li
                    key={`${reference.provider}-${reference.url ?? reference.placeId}`}
                  >
                    {reference.url &&
                      reference.qualification === "qualified" && (
                        <a
                          href={reference.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {reference.linkKind === "search"
                            ? "Search address on"
                            : "Open place on"}{" "}
                          {reference.provider}
                        </a>
                      )}
                    <p>
                      {reference.qualificationNotes} Checked{" "}
                      {reference.verifiedAt.slice(0, 10)}.
                    </p>
                  </li>
                ))}
              </ul>
              <p>
                Full reviews and exact navigation are not qualified. Address
                searches do not confirm a venue pin; check the branch before
                visiting.
              </p>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
