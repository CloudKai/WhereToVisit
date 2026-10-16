import { notFound } from "next/navigation";
// Private Trips (and organiser sign-in/sign-up) are switched off for now.
// The implementation in src/components/trips.tsx and src/server/ is kept so
// the feature can be re-enabled by restoring this page.
export default function Trips() {
  notFound();
}
