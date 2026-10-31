/** Small line diff (LCS) for config and agent-file previews: `-` removed, `+` added, 2 lines of context. */
export function lineDiff(before: string, after: string, context = 2): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return "(files too large to diff)";
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Array<[" " | "-" | "+", string]> = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) (ops.push([" ", a[i]]), i++, j++);
    else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) ops.push(["+", b[j++]]);
    else ops.push(["-", a[i++]]);
  }
  const keep = ops.map(([t], k) => t !== " " || ops.slice(Math.max(0, k - context), k + context + 1).some(([x]) => x !== " "));
  const out: string[] = [];
  let skipped = false;
  ops.forEach(([t, line], k) => {
    if (keep[k]) (out.push(`${t} ${line}`), (skipped = false));
    else if (!skipped) (out.push("  …"), (skipped = true));
  });
  return ops.some(([t]) => t !== " ") ? out.join("\n") : "";
}
