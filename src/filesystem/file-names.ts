/** Turning free text into a safe file name. */

const TRANSLITERATIONS: Record<string, string> = { "ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ð": "d", "þ": "th" };
const MAX_SLUG_LENGTH = 80;

/**
 * Lower-case file name stem built from a description: letters with accents become plain letters (ą → a, ł → l), every
 * other character that is not a letter or digit (spaces, punctuation, symbols) becomes a hyphen, runs of hyphens
 * collapse into one and hyphens at the ends are dropped. Returns an empty string when nothing usable is left.
 */
export function slugifyForFileName(text: string): string {
  const plain = Array.from(text.normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .map(char => TRANSLITERATIONS[char] ?? char)
    .join("");
  const slug = plain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
}
