import type { Metadata } from "next";
import Link from "next/link";
import { PlanNavLink } from "@/components/plan-nav-link";
import { PlanProvider } from "@/components/plan-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhereToVisit — cafés and tables worth travelling for",
  description:
    "Search any destination and see recommended cafés and restaurants, with the reason each one is worth a visit and where the recommendation comes from.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PlanProvider>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <header className="site-header">
            <div className="header-inner">
              <Link className="brand" href="/" aria-label="WhereToVisit home">
                <span className="brand-mark" aria-hidden="true">
                  ↗
                </span>
                WhereToVisit
              </Link>
              <nav aria-label="Primary">
                <Link href="/">Search</Link>
                <PlanNavLink />
                <Link href="/about">How it works</Link>
              </nav>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <footer className="site-footer">
            <p>
              Recommendations from{" "}
              <a
                href="https://www.wikivoyage.org/"
                target="_blank"
                rel="noreferrer noopener"
              >
                Wikivoyage
              </a>{" "}
              (CC BY-SA 4.0). Place data ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer noopener"
              >
                OpenStreetMap contributors
              </a>{" "}
              (ODbL), served by{" "}
              <a
                href="https://www.geoapify.com/"
                target="_blank"
                rel="noreferrer noopener"
              >
                Geoapify
              </a>
              .
            </p>
            <p>
              Always confirm hours and addresses with the venue before you
              travel.
            </p>
          </footer>
        </PlanProvider>
      </body>
    </html>
  );
}
