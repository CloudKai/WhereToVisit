export default function Loading() {
  return (
    <div className="page-section" aria-busy="true">
      <p className="eyebrow" role="status">
        Finding places…
      </p>
      <div className="skeleton skeleton-title" />
      <div className="grid">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="card skeleton-card" aria-hidden="true">
            <div className="skeleton skeleton-media" />
            <div className="card-body">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
