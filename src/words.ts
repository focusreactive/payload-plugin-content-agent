const UNSPACED =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}\\p{Script=Tibetan}";

/** A character of a script that is written without spaces between words. */
export const UNSPACED_SCRIPT = new RegExp(`[${UNSPACED}]`, "u");

const WORD = new RegExp(`[${UNSPACED}]|[^\\s${UNSPACED}]+`, "gu");

/**
 * The units a text is compared by: the runs between spaces, and each character of a script
 * written without spaces, where a run is a whole sentence.
 * @beta
 */
export function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}
