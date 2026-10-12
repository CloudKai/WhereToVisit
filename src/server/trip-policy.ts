import "server-only";
import type { Trip } from "@/shared/contracts";

export function visibleTripDataKind(dataKind: Trip["dataKind"]) {
  return (
    dataKind === "real" ||
    (process.env.NODE_ENV === "development" &&
      process.env.ENABLE_DEVELOPMENT_TRIP_FIXTURE === "1")
  );
}
