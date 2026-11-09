// Functions that run inside the application page. They must not reference anything outside
// themselves: Playwright sends their source text to the browser.

export type FieldKind = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'combobox' | 'file';

export interface Field {
  /** Our own handle, written on the element as data-aavedan. */
  id: string;
  kind: FieldKind;
  /** For text fields: email, tel, url, number, date… */
  inputType: string;
  label: string;
  required: boolean;
  options: string[];
  /** Checkbox groups and multi-selects take several options. */
  multi: boolean;
  maxLength: number | null;
  /** A combobox whose options appear only after typing (cities, schools). */
  searchable: boolean;
  value: string;
}

/** Finds every control a person would answer, tags it, and describes it. */
export function extractFields(): Field[] {
  const ws = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const clean = (s: string | null | undefined) => ws(s).replace(/\s*✱.*$/, '').replace(/\s*\*\s*$/, '').trim();
  const starred = (raw: string) => /✱|\*\s*$/.test(raw);
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const st = getComputedStyle(el as HTMLElement);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const rawOf = (el: Element | null) => ws((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const textOf = (el: Element | null) => clean(rawOf(el));
  const attachy = (t: string) => /^(attach|upload|choose file|browse|drop|enter manually)/i.test(t);

  /** The question's text as written, stars included. */
  const labelFor = (el: HTMLElement): string => {
    const own = (el as HTMLInputElement).labels?.[0];
    if (own && textOf(own) && !attachy(textOf(own))) return rawOf(own);
    for (const host of [el, el.closest('[role="group"][aria-labelledby], [role="radiogroup"][aria-labelledby]')]) {
      const by = host?.getAttribute('aria-labelledby');
      if (!by) continue;
      const t = by.split(/\s+/).map(id => rawOf(document.getElementById(id))).filter(Boolean).join(' ');
      if (t && !attachy(t)) return t;
    }
    const fs = el.closest('fieldset');
    const legend = fs?.querySelector('legend');
    if (legend && textOf(legend)) return rawOf(legend);
    // Walk up to the question's container and take its label-like element.
    let node: HTMLElement | null = el.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const cands = node.querySelectorAll(':scope > label, :scope > legend, :scope > [class*="label" i], :scope > [class*="question-title" i], :scope > [class*="title" i], :scope > div > label, :scope > div > [class*="label" i]');
      for (const cand of cands) if (!cand.contains(el) && textOf(cand) && !attachy(textOf(cand))) return rawOf(cand);
    }
    return ws(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '');
  };

  const isRequired = (el: HTMLElement, raw: string, container?: Element | null) =>
    (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' ||
    !!el.closest('[role="group"][aria-required="true"]') ||
    starred(ws(((container as HTMLElement | null)?.innerText ?? '').split('\n')[0])) ||
    starred(raw) || !!el.closest('[class*="required" i]');

  // The form with the most controls is the application.
  const forms = [...document.querySelectorAll('form')];
  const root: ParentNode = forms.sort((a, b) => b.querySelectorAll('input,select,textarea').length - a.querySelectorAll('input,select,textarea').length)[0] ?? document;

  const fields: Field[] = [];
  const done = new Set<Element>();
  let n = 0;
  const tag = (el: Element) => {
    const id = `f${++n}`;
    el.setAttribute('data-aavedan', id);
    return id;
  };

  const groups = new Map<string, HTMLInputElement[]>();
  for (const el of root.querySelectorAll<HTMLElement>('input, select, textarea, [role="combobox"]')) {
    if (done.has(el)) continue;
    const input = el as HTMLInputElement;
    const type = (input.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue;
    if (/recaptcha|h-captcha|hcaptcha/i.test(input.name || input.id || '')) continue;
    if (el.closest('.iti__dropdown-content, [class*="captcha" i]')) continue;
    if (type === 'file') {
      done.add(el);
      const box = el.closest('[role="group"], .application-question, [class*="field-wrapper" i], [class*="question" i], [class*="field" i]') ?? el.parentElement;
      let raw = labelFor(el);
      if (!raw || attachy(raw)) raw = rawOf(box?.querySelector('[id^="upload-label"], label, [class*="label" i]') ?? null);
      if (!raw || attachy(raw)) raw = input.name || el.id || 'File';
      // Ids like "resume" and "cover_letter" say more than a label that reads "Attach".
      const hint = `${input.name} ${el.id}`;
      let label = clean(raw);
      if (/cover/i.test(hint) && !/cover/i.test(label)) label = `Cover letter (${label})`;
      else if (/resume|\bcv\b/i.test(hint) && !/resume|cv/i.test(label)) label = `Resume (${label})`;
      const id = tag(el);
      box?.setAttribute('data-aavedan-box', id);
      fields.push({ id, kind: 'file', inputType: 'file', label, required: isRequired(el, raw, box), options: [], multi: input.multiple, maxLength: null, searchable: false, value: input.files?.[0]?.name ?? '' });
      continue;
    }
    if (!visible(el) && !(type === 'radio' || type === 'checkbox')) continue;
    // Greenhouse puts an unnamed, unlabelled required input next to each dropdown; skip it.
    if (!input.name && !el.id && !el.getAttribute('aria-label') && !(input.labels?.length) && el.tagName === 'INPUT' && !el.getAttribute('role')) continue;
    if (type === 'radio' || type === 'checkbox') {
      const key = `${type}:${input.name || el.id}`;
      const arr = groups.get(key) ?? [];
      arr.push(input);
      groups.set(key, arr);
      done.add(el);
      continue;
    }
    done.add(el);
    const raw = labelFor(el);
    const label = clean(raw);
    const isCombo = el.getAttribute('role') === 'combobox' || /select__input/.test(el.className) || el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('aria-haspopup') === 'listbox';
    if (el.tagName === 'SELECT') {
      const sel = el as HTMLSelectElement;
      const options = [...sel.options].filter(o => o.value !== '' && !/^(select|choose|--)/i.test(o.text.trim())).map(o => clean(o.text));
      fields.push({ id: tag(el), kind: 'select', inputType: 'select', label, required: isRequired(el, raw), options, multi: sel.multiple, maxLength: null, searchable: false, value: sel.selectedIndex >= 0 && sel.value ? clean(sel.options[sel.selectedIndex]?.text) : '' });
    } else if (isCombo) {
      fields.push({ id: tag(el), kind: 'combobox', inputType: 'combobox', label, required: isRequired(el, raw), options: [], multi: false, maxLength: null, searchable: false, value: '' });
    } else {
      const ml = (el as HTMLInputElement).maxLength;
      fields.push({ id: tag(el), kind: el.tagName === 'TEXTAREA' ? 'textarea' : 'text', inputType: el.tagName === 'TEXTAREA' ? 'textarea' : type || 'text', label, required: isRequired(el, raw), options: [], multi: false, maxLength: ml > 0 && ml < 100000 ? ml : null, searchable: false, value: input.value ?? '' });
    }
  }

  for (const [key, inputs] of groups) {
    const first = inputs[0]!;
    const type = key.split(':')[0]!;
    const optionLabel = (i: HTMLInputElement) => clean(i.labels?.[0] ? textOf(i.labels[0]) : i.getAttribute('aria-label') || i.value);
    // The question is the group's label; a lone checkbox ("I agree…") is its own question.
    let raw: string;
    if (inputs.length === 1 && type === 'checkbox') {
      const own = optionLabel(first);
      const outer = clean(labelFor(first.parentElement?.closest('div, li, fieldset') as HTMLElement ?? first));
      raw = outer && outer !== own ? `${outer} — ${own}` : own;
    } else {
      const fs = first.closest('fieldset');
      raw = rawOf(fs?.querySelector('legend') ?? null);
      const by = first.closest('[role="group"][aria-labelledby], [role="radiogroup"][aria-labelledby]')?.getAttribute('aria-labelledby');
      if (!raw && by) raw = by.split(/\s+/).map(x => rawOf(document.getElementById(x))).join(' ').trim();
      let label = raw;
      if (!label) {
        let node: HTMLElement | null = first.parentElement;
        for (let depth = 0; node && depth < 6 && !label; depth++, node = node.parentElement) {
          if (inputs.every(i => node!.contains(i))) {
            const cand = node.querySelector(':scope > label, :scope > legend, :scope > [class*="label" i], :scope > [class*="title" i], :scope > div > [class*="label" i]');
            if (cand && !inputs.some(i => cand.contains(i))) label = rawOf(cand);
          }
        }
      }
      raw = label || first.name;
    }
    const label = clean(raw);
    const id = `f${++n}`;
    inputs.forEach((i, k) => i.setAttribute('data-aavedan-opt', `${id}:${k}`));
    first.setAttribute('data-aavedan', id);
    const options = inputs.map(optionLabel);
    const checked = inputs.filter(i => i.checked).map(optionLabel);
    fields.push({ id, kind: type as FieldKind, inputType: type, label, required: inputs.some(i => i.required) || isRequired(first, raw, first.closest('fieldset')), options, multi: type === 'checkbox' && inputs.length > 1, maxLength: null, searchable: false, value: checked.join('; ') });
  }

  // Yes/No style button groups (Ashby) that have no input behind them.
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[type="button"], button:not([type])')].filter(b => visible(b) && /^(yes|no)$/i.test(textOf(b)));
  const byParent = new Map<Element, HTMLButtonElement[]>();
  for (const b of buttons) {
    const p = b.parentElement!;
    byParent.set(p, [...(byParent.get(p) ?? []), b]);
  }
  for (const [parent, bs] of byParent) {
    if (bs.length < 2) continue;
    const raw = labelFor(parent as HTMLElement);
    const label = clean(raw);
    const id = `f${++n}`;
    bs.forEach((b, k) => b.setAttribute('data-aavedan-opt', `${id}:${k}`));
    parent.setAttribute('data-aavedan', id);
    const chosen = bs.filter(b => b.getAttribute('aria-pressed') === 'true' || /active|selected/i.test(b.className)).map(b => textOf(b));
    fields.push({ id, kind: 'radio', inputType: 'buttons', label, required: isRequired(parent as HTMLElement, raw, parent.parentElement), options: bs.map(b => textOf(b)), multi: false, maxLength: null, searchable: false, value: chosen.join('; ') });
  }

  // Keep page order, so prompts and summaries read like the form.
  const order = (f: Field) => {
    const el = document.querySelector(`[data-aavedan="${f.id}"]`);
    return el ? [...document.querySelectorAll('[data-aavedan]')].indexOf(el) : 0;
  };
  return fields.sort((a, b) => order(a) - order(b));
}

/** What each tagged control shows right now, as a person would read it. */
export function readValues(): Record<string, string> {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const out: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLElement>('[data-aavedan]')) {
    const id = el.getAttribute('data-aavedan')!;
    const opts = [...document.querySelectorAll<HTMLElement>(`[data-aavedan-opt^="${id}:"]`)];
    if (opts.length) {
      out[id] = opts
        .filter(o => (o as HTMLInputElement).checked || o.getAttribute('aria-pressed') === 'true' || o.getAttribute('aria-checked') === 'true' || /(^|\s|_)(active|selected)/i.test(o.className))
        .map(o => clean((o as HTMLInputElement).labels?.[0]?.innerText || o.getAttribute('aria-label') || o.innerText || (o as HTMLInputElement).value))
        .join('; ');
      continue;
    }
    if (el.tagName === 'SELECT') {
      const s = el as HTMLSelectElement;
      out[id] = s.value ? clean(s.options[s.selectedIndex]?.text) : '';
    } else if ((el as HTMLInputElement).type === 'file') {
      const f = el as HTMLInputElement;
      out[id] = f.files?.length ? [...f.files].map(x => x.name).join('; ') : '';
    } else if (/select__input/.test(el.className) || el.getAttribute('role') === 'combobox') {
      // react-select shows its choice next to the input, not in it.
      let node: HTMLElement | null = el.parentElement;
      let shown = '';
      for (let d = 0; node && d < 5 && !shown; d++, node = node.parentElement) {
        // Stop before reaching a container that also holds another question.
        if (node.querySelectorAll('[data-aavedan]').length > 1) break;
        const sv = node.querySelector('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value__label" i]');
        if (sv) shown = [...node.querySelectorAll('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value__label" i]')].map(x => clean((x as HTMLElement).innerText)).join('; ');
      }
      out[id] = shown || clean((el as HTMLInputElement).value);
    } else {
      out[id] = (el as HTMLInputElement).value ?? '';
    }
  }
  // Uploads: the input may be gone, replaced by a chip with the file name.
  for (const box of document.querySelectorAll<HTMLElement>('[data-aavedan-box]')) {
    const id = box.getAttribute('data-aavedan-box')!;
    if (out[id]) continue;
    const named = box.querySelector<HTMLElement>('[class*="filename" i], [class*="file-name" i], [class*="chip" i]');
    const m = (named?.innerText || box.innerText || '').match(/[^\s/\\]+\.(pdf|docx?|txt|rtf|odt)\b/i);
    out[id] = m ? m[0] : '';
  }
  return out;
}

/** Visible error messages after a submit attempt. */
export function readErrors(): string[] {
  const nodes = [...document.querySelectorAll<HTMLElement>('[class*="error" i], [role="alert"], [aria-live="assertive"]')];
  return [...new Set(nodes.filter(n => n.offsetParent && n.innerText.trim() && n.innerText.length < 300).map(n => n.innerText.replace(/\s+/g, ' ').trim()))].slice(0, 10);
}
