// Three small forms written for these tests. Each copies a pattern a real board uses, not its markup:
// labels in sibling elements, a searchable dropdown that shows its choice outside the input,
// Yes/No buttons with no input behind them, and a checkbox group in a fieldset.

export const plainForm = `<!doctype html><html><body><form>
  <div class="application-question"><div class="application-label">Full name ✱</div><div><input type="text" name="name" required></div></div>
  <label>Email <input type="email" name="email" required></label>
  <label for="ph">Phone</label><input id="ph" type="tel" name="phone">
  <div class="q"><div class="label">Resume/CV ✱</div><input type="file" name="resume" style="opacity:0;position:absolute;width:1px;height:1px"></div>
  <div class="q"><div class="label">Notice period</div><select name="notice"><option value="">Select…</option><option>Immediate</option><option>15 days</option><option>30 days</option><option>60 days</option></select></div>
  <fieldset><legend>Are you willing to work from our Bengaluru office?</legend>
    <label><input type="radio" name="office" value="y"> Yes</label><label><input type="radio" name="office" value="n"> No</label></fieldset>
  <div class="q"><div class="label">Why do you want to join us?</div><textarea name="why" maxlength="500"></textarea></div>
  <label><input type="checkbox" name="consent"> I agree to the privacy policy</label>
  <button type="submit">Submit application</button>
</form></body></html>`;

export const comboForm = `<!doctype html><html><head><style>
  .opts { border: 1px solid #ccc; } .opts[hidden] { display: none; } [role=option] { padding: 4px; cursor: pointer; }
</style></head><body><form>
  <div class="field"><label for="country">Country*</label>
    <div class="select__control"><div class="select__value"></div><input id="country" class="select__input" role="combobox" aria-required="true" autocomplete="off"></div>
    <div class="opts" role="listbox" hidden></div></div>
  <div class="field"><label for="city">Location (City)*</label>
    <div class="select__control"><div class="select__value"></div><input id="city" class="select__input" role="combobox" aria-required="true" autocomplete="off"></div>
    <div class="opts" role="listbox" hidden></div></div>
  <fieldset><legend>Which countries could you work in?*</legend>
    <label><input type="checkbox" name="c[]" value="IN"> India</label><label><input type="checkbox" name="c[]" value="SG"> Singapore</label><label><input type="checkbox" name="c[]" value="US"> US</label></fieldset>
  <div class="field"><div class="label">Do you need sponsorship to work in India?</div><div class="yesno"><button type="button">Yes</button><button type="button">No</button></div></div>
</form>
<script>{
  const lists = { country: ['India', 'Indonesia', 'Singapore', 'United States'], city: null };
  const cities = ['Bengaluru, Karnataka, India', 'Bengaluru Rural, Karnataka, India', 'Pune, Maharashtra, India'];
  for (const input of document.querySelectorAll('.select__input')) {
    const box = input.closest('.field').querySelector('.opts');
    const shown = input.closest('.select__control').querySelector('.select__value');
    const all = () => lists[input.id] ?? (input.value.length >= 2 ? cities : []);
    const draw = () => {
      const q = input.value.toLowerCase();
      box.innerHTML = '';
      for (const o of all().filter(o => o.toLowerCase().includes(q))) {
        const d = document.createElement('div'); d.setAttribute('role', 'option'); d.textContent = o;
        d.addEventListener('mousedown', e => { e.preventDefault(); shown.className = 'select__single-value'; shown.textContent = o; input.value = ''; box.hidden = true; });
        box.appendChild(d);
      }
      box.hidden = false;
    };
    input.addEventListener('focus', draw); input.addEventListener('input', () => setTimeout(draw, 150));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') box.hidden = true; });
    input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 100));
  }
  for (const b of document.querySelectorAll('.yesno button')) b.addEventListener('click', () => {
    for (const x of b.parentElement.children) x.setAttribute('aria-pressed', String(x === b));
  });
}</script></body></html>`;
