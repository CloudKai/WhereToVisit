import Link from "next/link";
export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">A little inspiration. A better day out.</p>
        <h1>
          Find places worth
          <br className="desktop-break" /> going to.
        </h1>
        <p className="lead">
          Turn travel inspiration into places to visit, shared choices and a day
          that feels like yours.
        </p>
        <div className="actions">
          <Link className="button" href="/discover">
            Explore Shanghai <span aria-hidden="true">↗</span>
          </Link>
          <Link className="text-link" href="/import">
            Bring your inspiration →
          </Link>
        </div>
        <p className="scope">Starting with Shanghai food & cafés</p>
      </section>
      <section className="entry-grid" aria-label="Ways to get started">
        <Link className="entry-card" href="/discover">
          <span className="step">01 / DISCOVER</span>
          <h2>Start with a city.</h2>
          <p>
            Find food and cafés with clear sources behind every recommendation.
          </p>
          <span className="card-link">Discover Shanghai ↗</span>
        </Link>
        <Link className="entry-card" href="/import">
          <span className="step">02 / IMPORT</span>
          <h2>Keep the inspiration.</h2>
          <p>
            Bring the content that caught your eye and find the places behind
            it.
          </p>
          <span className="card-link">Explore imports ↗</span>
        </Link>
        <Link className="entry-card" href="/trips">
          <span className="step">03 / SAVE YOUR PLACES</span>
          <h2>Make it your day.</h2>
          <p>
            Keep a private Shanghai shortlist with the sources that inspired
            you. Choose confirmed branches and generate a day order, with real
            timing marked unresolved.
          </p>
          <span className="card-link">Explore trips ↗</span>
        </Link>
      </section>
    </>
  );
}
