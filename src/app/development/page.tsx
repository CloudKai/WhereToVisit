import { notFound } from "next/navigation";
import { OperationState } from "@/components/operation-state";
import { examplePlace } from "@/development/fixtures";
export const dynamic = "force-dynamic";
export default function Development() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ENABLE_DEVELOPMENT_FIXTURES !== "1"
  )
    notFound();
  return (
    <section className="page-section">
      <p className="eyebrow">DEVELOPMENT EXAMPLES — NOT REAL DATA</p>
      <h1>Layout examples</h1>
      <h2>{examplePlace.displayName}</h2>
      <p>{examplePlace.description}</p>
      <OperationState
        kind="loading"
        title="Loading example"
        message="This is an example of the shared loading presentation."
      />
      <OperationState
        kind="error"
        title="Error example"
        message="This is an example error, not a provider failure."
      />
      <OperationState
        kind="unavailable"
        title="Unavailable example"
        message="This is an example unavailable state."
      />
    </section>
  );
}
