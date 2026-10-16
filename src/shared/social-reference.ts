import { normalizedText, textError, textPolicies } from "./text-policy";

export const socialReferenceLimits = { lifetimeMs: 86400_000, drafts: 20 };
export type ReferenceBranch = {
  id: string;
  displayName: string;
  address: string | null;
  sources: { sourceUrl: string; capturedAt: string; limits: string }[];
};
export type SocialReference = {
  choiceRevision: number;
  branchChoice: { branchId: string; branch: ReferenceBranch | null } | null;
  id: string;
  platform: "Xiaohongshu" | "TikTok" | "Instagram";
  sourceUrl: string;
  note: string;
  createdAt: string;
  expiresAt: string;
};
export function socialReferenceInput(sourceUrl: unknown, note: unknown = "") {
  if (
    typeof sourceUrl !== "string" ||
    sourceUrl.length > 2048 ||
    /[\s\\\p{Cc}\p{Cf}]/u.test(sourceUrl)
  )
    throw new Error(
      "Enter a canonical HTTPS post URL without spaces or control characters (at most 2048 characters).",
    );
  // Match the supplied authority/path before URL parsing can normalize ambiguity.
  const parts =
    /^https:\/\/(www\.xiaohongshu\.com|www\.tiktok\.com|www\.instagram\.com)(\/[^?#]*)(?:[?#].*)?$/.exec(
      sourceUrl,
    );
  if (!parts)
    throw new Error(
      "Use a canonical www.xiaohongshu.com, www.tiktok.com or www.instagram.com HTTPS post link. Shortlinks, other hosts, credentials and ports are unsupported.",
    );
  const [, host, path] = parts;
  let platform: SocialReference["platform"];
  let canonicalPath: string;
  if (
    host === "www.xiaohongshu.com" &&
    /^\/explore\/[a-f0-9]{24}\/?$/.test(path)
  ) {
    platform = "Xiaohongshu";
    canonicalPath = path.replace(/\/$/, "");
  } else if (
    host === "www.tiktok.com" &&
    /^\/@[A-Za-z0-9._]{2,24}\/video\/[0-9]{1,30}\/?$/.test(path)
  ) {
    platform = "TikTok";
    canonicalPath = path.replace(/\/$/, "");
  } else if (
    host === "www.instagram.com" &&
    /^\/(p|reel)\/[A-Za-z0-9_-]{1,64}\/?$/.test(path)
  ) {
    platform = "Instagram";
    canonicalPath = `${path.replace(/\/$/, "")}/`;
  } else
    throw new Error(
      "Unsupported post path. Use Xiaohongshu /explore/post-id, TikTok /@name/video/id, or Instagram /p/code/ or /reel/code/. Profiles, search pages and encoded paths are unsupported.",
    );
  const error = textError(note, textPolicies.socialNote);
  if (error) throw new Error(error);
  return {
    platform,
    sourceUrl: `https://${host}${canonicalPath}`,
    note: normalizedText(
      typeof note === "string" ? note : "",
      textPolicies.socialNote,
    ),
    normalized: sourceUrl !== `https://${host}${canonicalPath}`,
  };
}
