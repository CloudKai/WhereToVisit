"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  ["/", "Home"],
  ["/discover", "Discover"],
  ["/import", "Import"],
  ["/trips", "Trips"],
] as const;

export function PrimaryNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary">
      {destinations.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={
            pathname === href ||
            (href !== "/" && pathname.startsWith(`${href}/`))
              ? "page"
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
