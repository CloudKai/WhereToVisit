import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How recommendations work — WhereToVisit",
};

export default function About() {
  return (
    <article className="page-section prose">
      <p className="eyebrow">Transparency</p>
      <h1>How recommendations work</h1>
      <p>
        There is no free, worldwide source of customer ratings, so this app does
        not show star ratings or “best of” scores. It shows what it can actually
        source, and labels each piece.
      </p>

      <h2>Where a recommendation comes from</h2>
      <ul>
        <li>
          <strong>Travel editors.</strong> Restaurants, cafés, shops, sights,
          museums and parks listed in{" "}
          <a
            href="https://www.wikivoyage.org/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Wikivoyage
          </a>{" "}
          destination guides, written by contributors and licensed CC BY-SA 4.0.
          These appear first, and each links to its article.
        </li>
        <li>
          <strong>Map contributors.</strong> A few places carry a short
          description added to{" "}
          <a
            href="https://www.openstreetmap.org/"
            target="_blank"
            rel="noreferrer noopener"
          >
            OpenStreetMap
          </a>
          . It is shown as “OpenStreetMap contributors”.
        </li>
        <li>
          <strong>Map data only.</strong> Everything else is a place that exists
          on the map. It is listed under “More places nearby” and ordered by how
          complete its information is. That is <em>not</em> a quality ranking.
        </li>
      </ul>

      <h2>What the AI does (and doesn’t)</h2>
      <p>
        When a note is long, an AI model may shorten it to one line. It is told
        to use only the source text, and the app rejects any line that adds a
        number or a name the source doesn’t contain. Condensed lines are tagged
        “AI-condensed”, and the full original is always available. The AI never
        decides which places are recommended and never writes about places that
        have no source text.
      </p>

      <h2>Why a city’s results can cluster in one district</h2>
      <p>
        The first view of a city looks around its centre point and shows the top
        few places of each type, ordered by how complete their information is.
        Districts with detailed guides and map data therefore come first, and
        places in thinly documented districts can be crowded out. Move the map
        to the part of the city you care about and press “Search this area” to
        see that area on its own terms.
      </p>

      <h2>Photos</h2>
      <p>
        Photos come from Wikimedia Commons and always link to their file page
        for the photographer and licence. A place gets a photo of its own when
        it has a Wikidata entry or Wikivoyage image. For landmarks, parks,
        museums and malls we may also use a geotagged photo taken at that spot;
        when it isn’t clearly of that place it is labelled “Photo taken nearby”.
        Most shops and cafés have no free photo, so they show an icon instead of
        a wrong picture.
      </p>

      <h2>Which sights and parks appear</h2>
      <p>
        Map data contains huge numbers of tiny sights and pocket parks. From the
        map data we only list sights and parks with some sign of being known —
        an encyclopedia entry, a website or a description — so the list isn’t
        full of benches and statues. Editor recommendations are not filtered
        this way.
      </p>

      <h2>Maps, routes and your trip</h2>
      <p>
        Add places to “Your trip” and organise them into days. Each day has its
        own map, route, start time and way of getting around (walk, bike or
        drive). Travel times follow real roads and paths when the routing
        service is available; otherwise they are labelled straight-line
        estimates. Each leg lists written directions when available, plus links
        that open live navigation in your own maps app. Times don’t include
        traffic, waiting or public transit, and opening hours are not checked
        against your schedule. Your trip stays in your browser and in the link
        you share; nothing is stored on our servers.
      </p>

      <h2>Voting with friends</h2>
      <p>
        You can turn your trip into a voting link. Friends choose a display name
        — there are no accounts — and vote Must go, Interested or Skip on each
        place, across every day of the trip. Everyone with the link sees the
        votes and the names entered, so share it only with people you trust. The
        organiser can close voting or delete the room, and rooms disappear after
        30 days of inactivity.
      </p>

      <h2>Practical details</h2>
      <p>
        Addresses, hours and phone numbers come from OpenStreetMap or Wikivoyage
        and can be out of date. Hours are shown exactly as mapped. Map buttons
        open your own maps app at the place’s coordinates; confirm the venue
        there, and with the venue itself, before you travel.
      </p>

      <p>
        <Link className="button" href="/">
          Start exploring
        </Link>
      </p>
    </article>
  );
}
