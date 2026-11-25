import { UNSPACED_SCRIPT } from "../../words.js";

/**
 * The query of a text search: a row matches when it holds ANY word of the text, and the rank
 * puts the rows with more of the words first. A question never has all its words in the answer.
 */
export function anyWordQuery(param: string): string {
  return `replace(plainto_tsquery('simple', ${param})::text, '&', '|')::tsquery`;
}

export function textRank(tsv: string, param: string): string {
  return `ts_rank(${tsv}, ${anyWordQuery(param)})`;
}

/**
 * The SQL condition of a text search. The full text parser takes a sentence written without
 * spaces as one word, so a query in such a script also matches as a substring.
 */
export function textMatch(query: string, tsv: string, text: string, param: string): string {
  const fullText = `${tsv} @@ ${anyWordQuery(param)}`;

  return UNSPACED_SCRIPT.test(query)
    ? `(${fullText} OR strpos(lower(${text}), lower(${param})) > 0)`
    : fullText;
}
