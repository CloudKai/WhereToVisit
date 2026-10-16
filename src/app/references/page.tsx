import { headers } from "next/headers";
import Link from "next/link";
import { SocialReferences } from "@/components/social-references";
import { localInstagramPreviewOrigin } from "@/server/instagram-preview";
export default async function ReferencesPage() {
  const requestHeaders = await headers();
  const previewOrigin = localInstagramPreviewOrigin(requestHeaders.get("host"));
  return (
    <section className="page-section references-page">
      <p className="eyebrow">YOUR INSPIRATION</p>
      <h1>Your social links</h1>
      <p className="lead">
        A temporary reference for your own browsing, with your original note.
      </p>
      <SocialReferences instagramPreviewOrigin={previewOrigin} />
      <p>
        Looking for listing names?{" "}
        <Link href="/import">Import a supported Wikivoyage article</Link>.
      </p>
    </section>
  );
}
