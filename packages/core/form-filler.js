/*
 * Fill in this form (Seekers 0.5.5, 25 Oct 2026, Job Seeker Pro and its trial).
 *
 * Injected into the job site's tab - every frame, because application
 * forms often sit in an iframe - ONLY when the person presses "Fill in
 * this form", via chrome.scripting.executeScript({ func: fillForm, args }).
 * It must be completely self-contained: no imports, no outer variables.
 *
 * What it does:
 *   - looks at each visible box, list and Yes/No choice on the page;
 *   - works out what it is asking from its label, its autocomplete hint,
 *     its placeholder and its name;
 *   - fills it with the person's own saved answer when it is sure, and
 *     only when the box is EMPTY - it never overwrites what is there;
 *   - outlines each box it filled in green, so it can be checked.
 *
 * What it never does: press submit, touch a password, file upload,
 * CAPTCHA or consent tick box, guess at a question it does not
 * recognise, or send anything anywhere. Equality monitoring answers are
 * used only when the person ticks "Include my equality answers", and
 * only from this browser's own storage.
 *
 * Returns { filled: [{ key, label }], frame } for this frame.
 */
export function fillForm(payload) {
  const answers = (payload && payload.answers) || {};
  const equality = (payload && payload.equality) || {};
  const MARK = 'data-ats-engine-filled';

  const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /* What each answer looks like on a form. `ac` are autocomplete tokens,
     `re` is matched against the box's label text (normalised). Order
     matters: the more specific questions come first. */
  const RULES = [
    { key: 'first_name', ac: ['given-name'], re: /\b(first|given|fore) ?names?\b|\bforename/ },
    { key: 'last_name', ac: ['family-name'], re: /\b(last|family|sur) ?names?\b|\bsurname/ },
    { key: 'email', ac: ['email'], re: /\be ?mail\b/ },
    { key: 'phone', ac: ['tel', 'tel-national'], re: /\b(phone|mobile|telephone|tel|contact number)\b/ },
    { key: 'postcode', ac: ['postal-code'], re: /\b(post ?code|postal code|zip)\b/ },
    { key: 'town', ac: ['address-level2'], re: /\b(town|city)\b/ },
    { key: 'address_line_1', ac: ['address-line1', 'street-address'], re: /\b(address line 1|address 1|street address|address)\b/ },
    { key: 'linkedin', ac: [], re: /\blinked ?in\b/ },
    { key: 'github', ac: [], re: /\bgithub\b/ },
    { key: 'portfolio', ac: ['url'], re: /\b(portfolio|personal website|website)\b/ },
    { key: 'sponsorship', ac: [], re: /\bsponsor/ },
    { key: 'right_to_work', ac: [], re: /\b(right to work|eligible to work|legally (entitled|allowed|able) to work|permission to work|work permit)\b/ },
    { key: 'salary', ac: [], re: /\b(salary|pay expectation|expected pay|desired pay|remuneration)\b/ },
    { key: 'notice', ac: [], re: /\bnotice period\b|\bperiod of notice\b|\bhow much notice\b|^notice\b/ },
    { key: 'dbs', ac: [], re: /\b(dbs|disclosure and barring|criminal record check)\b/ },
    { key: 'driving', ac: [], re: /\bdriv(ing|er s)? licen[cs]e\b|\bfull (uk )?licen[cs]e\b/ },
    { key: 'relocate', ac: [], re: /\breloca/ },
    { key: 'travel', ac: [], re: /\b(willing|able) to travel\b|\btravel\b/ },
    { key: 'availability', ac: [], re: /\b(availability|when can you start|start date|earliest start)\b/ },
    { key: 'clearance', ac: [], re: /\b(security clearance|clearance level)\b/ },
    { key: 'headline', ac: ['organization-title'], re: /\b(current|most recent|last) (job )?title\b|\bcurrent role\b/ },
    // Only "full name" / "name" on its own - after first/last name above.
    { key: 'name', ac: ['name'], re: /^(your )?(full )?name\b|\bfull name\b/ },
  ];
  const EQUALITY_RULES = [
    { key: 'gender_birth', re: /\b(same as|registered at birth|assigned at birth|trans)\b/ },
    { key: 'gender', re: /\b(gender|sex)\b/ },
    { key: 'age', re: /\b(age|age band|age range|date of birth band)\b/ },
    { key: 'ethnicity', re: /\b(ethnic|ethnicity|race)\b/ },
    { key: 'disability', re: /\b(disab|long term (health )?condition)\b/ },
    { key: 'orientation', re: /\b(sexual orientation|sexuality)\b/ },
    { key: 'religion', re: /\b(religion|belief|faith)\b/ },
    { key: 'caring', re: /\b(caring responsibilit|carer)\b/ },
  ];
  const NEVER = /\b(password|captcha|card number|cvv|cvc|sort code|account number|national insurance|ni number|passport|date of birth|dob|signature|security answer)\b/;

  const visible = (el) => {
    if (el.disabled || el.readOnly || el.type === 'hidden') return false;
    if (el.closest('[hidden], [aria-hidden="true"]')) return false;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };

  const textOf = (node) => (node ? node.textContent || '' : '');

  function labelFor(el) {
    const doc = el.ownerDocument;
    const parts = [];
    if (el.id) {
      try {
        doc.querySelectorAll(`label[for="${esc(el.id)}"]`).forEach((l) => parts.push(textOf(l)));
      } catch { /* odd id */ }
    }
    const wrap = el.closest('label');
    if (wrap) parts.push(textOf(wrap));
    const by = el.getAttribute('aria-labelledby');
    if (by) by.split(/\s+/).forEach((id) => parts.push(textOf(doc.getElementById(id))));
    parts.push(el.getAttribute('aria-label') || '');
    if (!parts.join('').trim()) {
      // A question written just above the box, in the same field wrapper.
      const box = el.closest('fieldset, .field, .form-group, .form-field, [class*="question"], [class*="field"], li, div');
      const legend = box && box.querySelector('legend, label, h3, h4, p, span');
      if (legend && !legend.contains(el)) parts.push(textOf(legend));
    }
    parts.push(el.getAttribute('placeholder') || '');
    parts.push((el.getAttribute('name') || '').replace(/[_\-[\].]+/g, ' '));
    parts.push((el.id || '').replace(/[_\-]+/g, ' '));
    return norm(parts.join(' ').slice(0, 400));
  }

  function keyFor(el, label) {
    if (NEVER.test(label)) return null;
    const ac = norm(el.getAttribute('autocomplete')).split(' ');
    for (const r of RULES) if (r.ac.some((t) => ac.includes(t.replace(/-/g, ' ')))) return { kind: 'answer', key: r.key };
    for (const r of RULES) if (r.re.test(label)) return { kind: 'answer', key: r.key };
    if (payload && payload.includeEquality) {
      for (const r of EQUALITY_RULES) if (r.re.test(label)) return { kind: 'equality', key: r.key };
    }
    return null;
  }

  /* The value for a key: some come straight from the saved answers, some
     are worked out (first and last name from the full name). */
  function valueFor(match) {
    if (match.kind === 'equality') return equality[match.key] || null;
    const full = String(answers.name || '').trim();
    if (match.key === 'first_name') return full ? full.split(/\s+/)[0] : null;
    if (match.key === 'last_name') return full.includes(' ') ? full.split(/\s+/).slice(1).join(' ') : null;
    if (match.key === 'address_line_1') {
      const a = String(answers.address || '').split(',')[0].trim();
      return a || null;
    }
    const v = answers[match.key];
    return v == null || String(v).trim() === '' ? null : String(v);
  }

  /* Set a value the way typing would, so the page's own scripts (React,
     Angular, Vue) notice it. */
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function mark(el) {
    el.setAttribute(MARK, '1');
    el.style.outline = '2px solid #16a34a';
    el.style.outlineOffset = '1px';
    el.style.backgroundColor = '#f0fdf4';
  }

  /* A list: pick the option that says the same thing, or nothing. */
  function pickOption(select, value) {
    const want = norm(value);
    if (!want) return null;
    const opts = Array.from(select.options).filter((o) => !o.disabled && norm(o.textContent));
    const exact = opts.find((o) => norm(o.textContent) === want || norm(o.value) === want);
    if (exact) return exact;
    // "Yes - I have the right to work" for Yes; "Prefer not to say" variants.
    const starts = opts.filter((o) => norm(o.textContent).startsWith(want + ' ') || norm(o.textContent).startsWith(want));
    if (starts.length === 1) return starts[0];
    const contains = opts.filter((o) => norm(o.textContent).includes(want));
    return contains.length === 1 ? contains[0] : null;
  }

  const filled = [];
  const done = new Set();
  const doc = document;

  // Boxes and lists.
  doc.querySelectorAll('input, textarea, select').forEach((el) => {
    if (el.hasAttribute(MARK)) return;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (el.tagName === 'INPUT' && !['text', 'email', 'tel', 'url', 'search', ''].includes(type)) return;
    if (!visible(el)) return;
    const label = labelFor(el);
    const match = keyFor(el, label);
    if (!match) return;
    const value = valueFor(match);
    if (!value) return;

    if (el.tagName === 'SELECT') {
      if (el.selectedIndex > 0 && norm(el.options[el.selectedIndex].textContent)) return; // already chosen
      const opt = pickOption(el, value);
      if (!opt) return;
      setValue(el, opt.value);
    } else {
      if (String(el.value || '').trim() !== '') return; // never overwrite
      setValue(el, value);
    }
    mark(el);
    filled.push({ key: match.key, label: label.slice(0, 80) });
    done.add(match.key + ':' + label);
  });

  // Yes / No and other choices shown as radio buttons, one group at a time.
  const groups = new Map();
  doc.querySelectorAll('input[type="radio"]').forEach((r) => {
    if (r.disabled || !r.name) return;
    if (!groups.has(r.name)) groups.set(r.name, []);
    groups.get(r.name).push(r);
  });
  groups.forEach((radios) => {
    if (radios.some((r) => r.checked)) return; // already answered
    const first = radios[0];
    // The smallest container that holds the whole group: its legend, or
    // its text, is the question.
    let box = first.closest('fieldset, [role="radiogroup"]');
    if (!box) {
      box = first.parentElement;
      while (box && !radios.every((r) => box.contains(r))) box = box.parentElement;
    }
    if (!box || box === doc.body) return;
    const legend = box.querySelector('legend, [role="heading"]');
    const question = norm((legend || box).textContent || '').slice(0, 300) + ' ' + norm(first.name);
    const match = keyFor(first, question);
    if (!match) return;
    const value = valueFor(match);
    if (!value) return;
    const want = norm(value);
    const optionText = (r) => {
      const l = labelFor(r);
      return l;
    };
    const exact = radios.filter((r) => norm(r.value) === want || optionText(r).split(' ').slice(0, want.split(' ').length).join(' ') === want);
    const pick = exact.length === 1 ? exact[0] : null;
    if (!pick) return;
    pick.click();
    if (!pick.checked) {
      pick.checked = true;
      pick.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const lab = pick.closest('label') || (pick.id && doc.querySelector(`label[for="${esc(pick.id)}"]`));
    mark(lab || pick);
    filled.push({ key: match.key, label: question.slice(0, 80) });
  });

  return { filled, frame: location.href };
}

/* For the panel: what the fill result means, in words. */
export function fillSummary(results) {
  const all = (results || []).flatMap((r) => (r && r.result && r.result.filled) || (r && r.filled) || []);
  const n = all.length;
  if (n === 0) {
    return {
      tone: 'warn',
      text: 'Nothing was filled in: either the boxes were already filled, or none of them asked for something you have saved. Copy your answers below instead.',
      count: 0,
    };
  }
  return {
    tone: 'ok',
    text: `Filled in ${n} box${n === 1 ? '' : 'es'}, outlined in green. Check each one before you send the form - nothing has been submitted.`,
    count: n,
  };
}
