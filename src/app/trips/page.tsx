import Link from "next/link";
import { OperationState } from "@/components/operation-state";
export default function Trips() {
  return (
    <section className="page-section">
      <p className="eyebrow">CHOOSE TOGETHER</p>
      <h1>Your next trip</h1>
      <p className="lead">
        A shared shortlist today. A day worth looking forward to.
      </p>
      <OperationState
        kind="unavailable"
        title="Trip planning is not available yet"
        message="Saving places, signing in and inviting companions are still being prepared. You do not have a saved trip in this app yet."
      >
        <Link className="text-link" href="/discover">
          Start with discovery →
        </Link>
      </OperationState>
    </section>
  );
}
