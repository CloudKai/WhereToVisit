import Link from "next/link";

export default function NotFound() {
  return (
    <section className="page-section problem">
      <h1>Page not found</h1>
      <p>
        That page doesn’t exist. <Link href="/">Search for a destination</Link>.
      </p>
    </section>
  );
}
