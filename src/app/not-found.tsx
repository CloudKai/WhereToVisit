import Link from "next/link";
export default function NotFound() {
  return (
    <section className="page-section">
      <p className="eyebrow">PAGE NOT FOUND</p>
      <h1>Let’s find your way back.</h1>
      <p className="lead">This page is not available.</p>
      <Link className="button" href="/">
        Return home →
      </Link>
    </section>
  );
}
