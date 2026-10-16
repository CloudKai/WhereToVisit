import Link from "next/link";
export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">THE SHANGHAI JOURNAL / FOOD & CAFÉS</p>
        <h1>
          Find places worth
          <br className="desktop-break" /> going to.
        </h1>
        <p className="lead">
          Start with six source-backed Shanghai branches. Keep a private
          shortlist, choose with your companions and put your chosen stops in
          order.
        </p>
        <div className="actions">
          <Link className="button" href="/discover">
            Explore Shanghai <span aria-hidden="true">↗</span>
          </Link>
          <Link className="text-link" href="/import">
            Import a Wikivoyage listing →
          </Link>
        </div>
        <p className="scope">
          Browse without an account. Sign in when you want to save.
        </p>
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
            Import Eat/Drink listing names from supported English Wikivoyage
            articles. Review possible branches before saving; a listing name
            alone does not confirm a place.
          </p>
          <span className="card-link">Explore imports ↗</span>
        </Link>
        <Link className="entry-card" href="/trips">
          <span className="step">03 / SAVE YOUR PLACES</span>
          <h2>Make it your day.</h2>
          <p>
            Invite companions to suggest, comment and choose Must go, Interested
            or Skip. You make the final selection and an editable day order.
            Solo Trips work too.
          </p>
          <span className="card-link">Explore trips ↗</span>
        </Link>
      </section>
      <aside className="home-boundaries" aria-label="Before your visit">
        <h2>A guide to choosing. Check before going.</h2>
        <p>
          Current opening hours, journey times and exact maps/navigation are
          still unavailable. Address-search links help you check a branch; the
          day plan shows an order with timings unresolved. Social, video and
          general blog imports are not supported yet.
        </p>
      </aside>
    </>
  );
}
