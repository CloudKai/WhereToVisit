/** Fictional scenario data; not venue verification and never a release catalogue. */
export function catalogueFixture() {
  const evidence = (id: string, summary: string) => ({
    id,
    sourceUrl: `https://example.invalid/${id}`,
    capturedAt: "2026-10-12T00:00:00Z",
    publishedAt: null,
    attribution: "Fictional scenario author",
    permission: "Test-only fictional content",
    status: "current",
    establishedFacts: ["identity", "category", "neighbourhood"],
    limits: "Fictional scenario; proves application behaviour only.",
    recommendation: {
      summary,
      mentionedExperience: "Fictional coffee experience",
    },
  });
  const place = (id: string, branch: string, address: string) => ({
    id,
    city: "Shanghai",
    category: "cafe",
    displayName: "Fictional Scenario Café",
    localName: "虚构测试咖啡馆",
    branch,
    address,
    neighbourhood: "Fictional neighbourhood",
    coordinates: null,
    price: null,
    hours: null,
    rating: null,
    classifications: [],
    operationStatus: "unknown",
    evidence: [evidence(`${id}-source`, "Fictional praise for the coffee")],
    providerReferences: [
      {
        provider: "Scenario map",
        placeId: null,
        url: "https://example.invalid/map-search",
        linkKind: "search",
        surface: "Fictional external address search",
        apiVersion: null,
        returnedName: null,
        returnedAddress: null,
        language: null,
        coordinates: null,
        verifiedAt: "2026-10-12T00:00:00Z",
        qualification: "qualified",
        qualificationNotes:
          "Fictional reference; no actual provider connectivity.",
      },
    ],
  });
  const first = place(
    "fictional-cafe-east",
    "East branch",
    "1 Fictional East Road, Shanghai",
  );
  first.evidence.push(
    evidence("east-second-source", "A second fictional recommendation"),
  );
  return {
    version: 1,
    kind: "fixture",
    city: "Shanghai",
    status: "published",
    coverageMessage:
      "Fictional test catalogue. Two scenario branches; not Shanghai venue coverage.",
    unavailableReason: null,
    places: [
      first,
      place(
        "fictional-cafe-west",
        "West branch",
        "2 Fictional West Road, Shanghai",
      ),
    ],
  };
}
