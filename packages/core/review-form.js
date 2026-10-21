/*
 * The captured job, laid out for checking before anything is saved
 * (21 Oct 2026). Shared by both extensions: same fields, same labels,
 * same "Not found on the page" for anything the page did not show.
 */
import { h } from './dom.js';
import { VACANCY_FIELDS } from './fields.js';

export function reviewForm(values) {
  const inputs = {};
  const nodes = VACANCY_FIELDS.map((f) => {
    const id = `f-${f.key}`;
    const control = f.multiline
      ? h('textarea', { id, placeholder: 'Not found on the page - add it if you know it' })
      : h('input', { id, type: 'text', placeholder: 'Not found on the page' });
    control.value = values[f.key] || '';
    inputs[f.key] = control;
    return h('div', {}, h('label', { for: id }, f.label, f.required ? h('span', { class: 'req', text: ' *' }) : null), control);
  });

  return {
    nodes,
    read() {
      const v = { source_url: values.source_url };
      for (const [k, el] of Object.entries(inputs)) v[k] = el.value;
      return v;
    },
  };
}
