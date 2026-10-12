import Link from "next/link";
import { OperationState } from "@/components/operation-state";
export default function Import() {
  return (
    <section className="page-section">
      <p className="eyebrow">YOUR INSPIRATION</p>
      <h1>Bring your inspiration</h1>
      <p className="lead">
        Keep the source. Find the place. Confirm the right branch.
      </p>
      <OperationState
        kind="unavailable"
        title="Imports are not available yet"
        message="Supported sources and place identification are still being prepared. No links can be processed here yet."
      >
        <Link className="text-link" href="/discover">
          Explore discovery →
        </Link>
      </OperationState>
    </section>
  );
}
