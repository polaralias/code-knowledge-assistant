export function parseHostedAccessCodes(value: string | undefined): readonly string[] {
  if (typeof value !== "string" || value.length < 1 || value.length > 16_384) throw new Error("REVIEW_ACCESS_CODES_INVALID");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("REVIEW_ACCESS_CODES_INVALID"); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100
    || parsed.some((code) => typeof code !== "string" || code.length < 1 || code.length > 256 || /[\u0000-\u001f\u007f]/u.test(code))
    || new Set(parsed).size !== parsed.length) {
    throw new Error("REVIEW_ACCESS_CODES_INVALID");
  }
  return Object.freeze([...parsed]) as readonly string[];
}
