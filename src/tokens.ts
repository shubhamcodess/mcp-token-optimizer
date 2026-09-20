/**
 * Fast, dependency-free token estimator. It is deliberately model-agnostic: exact counts differ per
 * tokenizer, but relative savings (which is all we use it for) track closely across BPE vocabularies.
 */
export function estimateTokens(s: string): number {
  if (!s) return 0;
  let n = 0;
  const re = /[A-Za-zÀ-ɏ]+|\d{1,3}|[^\sA-Za-z\dÀ-ɏ]/gu;
  for (const m of s.matchAll(re)) {
    const t = m[0];
    n += /^[A-Za-zÀ-ɏ]/.test(t) ? Math.max(1, Math.ceil(t.length / 5)) : 1;
  }
  // newline/indent runs cost a little on real tokenizers
  n += Math.ceil((s.match(/\n/g)?.length ?? 0) * 0.5);
  return n;
}
