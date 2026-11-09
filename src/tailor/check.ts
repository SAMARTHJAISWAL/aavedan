// The fact check: every number and every proper name in generated text must already exist in the
// profile or the posting. This is code, not a prompt, so a fluent invention cannot slip through.

const STOP = new Set(['i', 'i\'m', 'i\'ve', 'i\'d', 'my', 'the', 'a', 'an', 'and', 'in', 'at', 'on', 'for', 'to', 'of', 'with', 'as', 'by', 'from', 'this', 'that', 'it', 'we', 'you', 'your', 'our', 'dear', 'hiring', 'team', 'manager', 'regards', 'sincerely', 'best', 'thank', 'thanks', 'hello', 'hi', 'yes', 'no', 'english', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

/** Numbers and names in `text`, as written. */
export function claims(text: string): { numbers: string[]; names: string[] } {
  const numbers = [...text.matchAll(/(?<![\w.])\d[\d,.]*(?:\s?(?:%|x|k|m|cr|lpa|lakh|crore|\+))?/gi)].map(m => m[0].replace(/[.,]+$/, ''));
  const names: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:;\n•])\s+|\n+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((raw, i) => {
      const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#.]+$/gu, '').replace(/\.$/, '');
      if (!w || STOP.has(w.toLowerCase())) return;
      const acronym = /^[A-Z][A-Z0-9+#.]{1,}$/.test(w);
      const tech = /[a-z][A-Z]|\.\w|\w#|\+\+/.test(w);
      const proper = i > 0 && /^\p{Lu}/u.test(w);
      if (acronym || tech || proper) names.push(w);
    });
  }
  return { numbers: [...new Set(numbers)], names: [...new Set(names)] };
}

const simple = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, '');

/** Claims in `text` that `sources` do not support. Empty means the text passes. */
export function unsupported(text: string, sources: string[]): string[] {
  const corpus = sources.join('\n');
  const flat = simple(corpus);
  const numbersInSources = new Set([...corpus.matchAll(/\d[\d,.]*/g)].map(m => m[0].replace(/[,]/g, '').replace(/\.$/, '')));
  const { numbers, names } = claims(text);
  const bad: string[] = [];
  for (const n of numbers) {
    const core = n.replace(/[^\d.]/g, '').replace(/\.$/, '');
    if (core && !numbersInSources.has(core) && !numbersInSources.has(core.replace(/,/g, ''))) bad.push(n);
  }
  for (const name of names) if (!flat.includes(simple(name))) bad.push(name);
  return bad;
}
