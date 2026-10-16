import { notFound } from "next/navigation";
// Shared Trip access is switched off together with private Trips.
export default function SharedTrip() {
  notFound();
}
