import { OperationState } from "@/components/operation-state";
export default function Loading() {
  return (
    <div className="page-section">
      <OperationState
        kind="loading"
        title="Getting things ready"
        message="Please wait while this page loads."
      />
    </div>
  );
}
