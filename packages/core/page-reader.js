/*
 * Reads the job advert the person is looking at (21 Oct 2026).
 *
 * Injected into the current tab ONLY when the person clicks Capture, via
 * chrome.scripting.executeScript({ func: readPage }). It must therefore be
 * completely self-contained: no imports, no outer variables - the browser
 * serialises the function text and runs it in the page's isolated world.
 *
 * It reads and returns; it never changes the page, never runs the page's
 * scripts, and never sees the extension's token.
 *
 * What it sends: the page's HTML as the person's own browser rendered it,
 * with everything that is not content removed (scripts other than the
 * JSON-LD job data, styles, media, inline event handlers), so the server
 * can read it with the same extraction ATS Engine uses for every other
 * way a posting arrives. Plus any text the person highlighted.
 */
export function readPage(maxBytes = 2_500_000) {
  const clone = document.documentElement.cloneNode(true);

  clone
    .querySelectorAll(
      'script:not([type="application/ld+json"]), style, noscript, svg, iframe, template, canvas, video, audio, object, embed, link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"]',
    )
    .forEach((node) => node.remove());

  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || attr.name === 'style' || attr.name === 'srcset') {
        el.removeAttribute(attr.name);
      }
    }
  });

  let html = '<!DOCTYPE html>' + clone.outerHTML;
  if (html.length > maxBytes) {
    html = html.slice(0, maxBytes);
  }

  const selection = String(window.getSelection ? window.getSelection() : '').trim().slice(0, 30000);

  return { url: location.href, title: document.title || '', html, selection };
}
