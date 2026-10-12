type Props = {
  kind: "loading" | "error" | "unavailable";
  title: string;
  message: string;
  children?: React.ReactNode;
};
export function OperationState({ kind, title, message, children }: Props) {
  return (
    <section
      className="operation-state"
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-busy={kind === "loading"}
    >
      <span className="state-marker" aria-hidden="true">
        {kind === "loading" ? "◌" : kind === "error" ? "!" : "—"}
      </span>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {children}
      </div>
    </section>
  );
}
