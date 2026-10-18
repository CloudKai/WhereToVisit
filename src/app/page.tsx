import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { exploreHref, POPULAR_DESTINATIONS } from "@/lib/destination";

export default function Home() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">
          Food · shopping · sights · parks · anywhere in the world
        </p>
        <h1>
          Find the places worth <em>travelling</em> for.
        </h1>
        <p className="lead">
          Search a city or neighbourhood. See places that travel editors
          recommend — each with the reason to go, where that reason comes from,
          and the practical details to check before you leave.
        </p>
        <SearchBox autoFocus />
      </section>

      <section className="popular" aria-labelledby="popular-heading">
        <h2 id="popular-heading">Or start somewhere popular</h2>
        <ul className="popular-grid">
          {POPULAR_DESTINATIONS.map((city, index) => (
            <li key={city.name}>
              <Link
                href={exploreHref(city)}
                className="popular-card"
                style={
                  {
                    "--h1": (index * 47) % 360,
                    "--h2": (index * 47 + 48) % 360,
                  } as React.CSSProperties
                }
              >
                <span className="popular-name">{city.name}</span>
                <span className="popular-country">{city.country}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="steps" aria-label="How it works">
        <div>
          <span className="step">01</span>
          <h3>Pick a destination</h3>
          <p>Any city or neighbourhood, worldwide.</p>
        </div>
        <div>
          <span className="step">02</span>
          <h3>See why each place is recommended</h3>
          <p>
            Editor picks come first, with the source of every recommendation
            shown on the card.
          </p>
        </div>
        <div>
          <span className="step">03</span>
          <h3>Check the details</h3>
          <p>Address, hours and your preferred maps app, one tap away.</p>
        </div>
      </section>
    </>
  );
}
