/*
 * The popups' one way to make elements (21 Oct 2026). Text only, never
 * HTML: every word from a page or from ATS Engine goes in through
 * textContent / text nodes, so nothing on a job page can run in the popup.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function notice(kind, text) {
  return h('div', { class: `notice ${kind}`, role: kind === 'bad' ? 'alert' : undefined, text });
}

/** Replace a container's contents, skipping empty slots. */
export function fill(container, ...nodes) {
  container.replaceChildren(...nodes.flat().filter(Boolean));
}
