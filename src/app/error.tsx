"use client";
import { OperationState } from "@/components/operation-state";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="page-section">
      <OperationState
        kind="error"
        title="This page could not load"
        message="Please try again. If the problem continues, return home."
      >
        <button className="button" type="button" onClick={reset}>
          Try again
        </button>
      </OperationState>
    </div>
  );
}
