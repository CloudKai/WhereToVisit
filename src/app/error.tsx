"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <section className="page-section problem" role="alert">
      <h1>Something went wrong</h1>
      <p>The page couldn’t be shown. This is usually temporary.</p>
      <button type="button" className="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
