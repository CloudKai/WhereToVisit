import type { Metadata } from "next";
import Link from "next/link";
import { PrimaryNavigation } from "@/components/primary-navigation";
import "./globals.css";
export const metadata: Metadata = {
  title: "WhereToVisit — Inspiration to a day out",
  description:
    "Discover Shanghai food and cafés, bring your inspiration, and choose places together.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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
            <PrimaryNavigation />
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer>
          <span>WhereToVisit</span>
          <span>Made for your next day out.</span>
        </footer>
      </body>
    </html>
  );
}
