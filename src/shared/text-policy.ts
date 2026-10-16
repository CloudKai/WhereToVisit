export const textPolicies = {
  socialNote: { label: "Your note", limit: 500, multiline: true },
  guestName: { label: "Display name", limit: 80, required: true },
  comment: { label: "Comment", limit: 1000, required: true, multiline: true },
  suggestion: { label: "Place name", limit: 120, required: true },
  startArea: { label: "Start area or hotel", limit: 200 },
  budget: { label: "Budget", limit: 120 },
  dietaryNeeds: { label: "Dietary needs", limit: 500 },
} satisfies Record<string, TextPolicy>;
export type TextPolicy = {
  label: string;
  limit: number;
  required?: boolean;
  multiline?: boolean;
};
export function normalizedText(value: string, policy: TextPolicy) {
  return (policy.multiline ? value.replace(/\r\n/g, "\n") : value).trim();
}
export function textError(value: unknown, policy: TextPolicy): string {
  if (!policy.required && (value === undefined || value === null)) return "";
  if (typeof value !== "string") return `${policy.label}: enter text.`;
  const normalized = normalizedText(value, policy);
  const controlChecked = policy.multiline
    ? value.replace(/\r\n/g, "\n").replace(/\n/g, "")
    : value;
  if (/[\p{Cc}\p{Cf}]/u.test(controlChecked))
    return `${policy.label}: remove control or format characters.${policy.multiline ? " Ordinary line breaks are allowed." : " Line breaks are not allowed."}`;
  if (policy.required && !normalized)
    return `${policy.label}: enter at least one character after trimming spaces.`;
  if (Array.from(normalized).length > policy.limit)
    return `${policy.label}: use at most ${policy.limit} Unicode characters after trimming spaces.`;
  return "";
}
