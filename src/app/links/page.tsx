import type { Metadata } from "next";
import { LinkImport } from "@/components/link-import";

export const metadata: Metadata = {
  title: "From links — WhereToVisit",
};

export default function LinksPage() {
  return <LinkImport />;
}
