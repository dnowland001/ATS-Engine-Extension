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

/** One page of a list: the items on it, which page it is, how many pages. */
export function pageSlice(items, page, per) {
  const list = items || [];
  const pages = Math.max(1, Math.ceil(list.length / per));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * per, p * per), page: p, pages, from: list.length ? (p - 1) * per + 1 : 0, to: Math.min(p * per, list.length), total: list.length };
}

/*
 * A list shown a few items at a time (22 Oct 2026), with Previous / Next
 * under it. `renderList(itemsOnThisPage)` draws the list; with one page
 * there is no pager at all.
 */
export function paged(items, per, renderList, name = 'items') {
  const box = h('div', { class: 'paged' });
  const draw = (page) => {
    const s = pageSlice(items, page, per);
    fill(
      box,
      renderList(s.items),
      s.pages > 1
        ? h('div', { class: 'pager', role: 'navigation', 'aria-label': `${name} pages` },
            h('button', { class: 'pager-btn', type: 'button', text: '‹ Previous', disabled: s.page === 1, onclick: () => draw(s.page - 1) }),
            h('span', { class: 'pager-at', text: `${s.from}-${s.to} of ${s.total}` }),
            h('button', { class: 'pager-btn', type: 'button', text: 'Next ›', disabled: s.page === s.pages, onclick: () => draw(s.page + 1) }))
        : null,
    );
  };
  draw(1);
  return box;
}
