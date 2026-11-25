// Bytes, not characters: non-Latin scripts tokenize at about their UTF-8 byte weight.
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf-8") / 4);
}
