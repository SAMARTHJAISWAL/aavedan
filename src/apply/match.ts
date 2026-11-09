// Pure helpers for matching an intended answer against what a form offers and shows.

export const norm = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}+]+/gu, ' ').trim();

/** The option a person would pick for `wanted`, or null when none is a clear match. */
export function pickOption(options: string[], wanted: string): string | null {
  const w = norm(wanted);
  if (!w) return null;
  const exact = options.find(o => norm(o) === w);
  if (exact) return exact;
  const starts = options.filter(o => norm(o).startsWith(w + ' ') || w.startsWith(norm(o) + ' '));
  if (starts.length === 1) return starts[0]!;
  const contains = options.filter(o => norm(o).includes(w));
  if (contains.length === 1) return contains[0]!;
  // Yes/No questions often carry long option text: "Yes, I am authorized…".
  if (w === 'yes' || w === 'no') {
    const yn = options.filter(o => norm(o).split(' ')[0] === w);
    if (yn.length === 1) return yn[0]!;
  }
  return null;
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Does the page show what we meant to put there? */
export function shows(kind: string, inputType: string, wanted: string[], shown: string): boolean {
  if (kind === 'file') return shown.trim().length > 0;
  if (inputType === 'tel') {
    const a = digits(wanted[0] ?? ''), b = digits(shown);
    return b.length >= 7 && (a.endsWith(b) || b.endsWith(a.slice(-10)));
  }
  if (kind === 'text' || kind === 'textarea') return (wanted[0] ?? '').trim() === shown.trim();
  const s = norm(shown);
  if (kind === 'combobox' && wanted.length === 1 && s.length >= 2 && norm(wanted[0]!).includes(s)) return true;
  return wanted.every(w => s.includes(norm(w)));
}
