// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readPage } from '../../packages/core/page-reader.js';

describe('readPage', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = `
      <head><title>Care Assistant - Acme Care</title>
        <style>.x{color:red}</style>
        <script>window.secret = 1</script>
        <script type="application/ld+json">{"@type":"JobPosting","title":"Care Assistant"}</script>
      </head>
      <body>
        <h1 onclick="steal()" style="color:red">Care Assistant</h1>
        <img src="a.png" srcset="a2.png 2x">
        <iframe src="https://ads.example"></iframe>
        <p id="desc">Supporting residents with daily living.</p>
      </body>`;
  });

  it('keeps the advert and the JSON-LD job data', () => {
    const page = readPage();
    expect(page.title).toBe('Care Assistant - Acme Care');
    expect(page.html).toContain('Supporting residents with daily living.');
    expect(page.html).toContain('"@type":"JobPosting"');
    expect(page.url).toBe(location.href);
  });

  it('removes scripts, styles, frames and inline handlers', () => {
    const { html } = readPage();
    expect(html).not.toContain('window.secret');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('srcset');
  });

  it('never changes the page itself', () => {
    readPage();
    expect(document.querySelector('h1').getAttribute('onclick')).toBe('steal()');
    expect(document.querySelectorAll('script').length).toBe(2);
  });

  it('sends the highlighted text', () => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('desc'));
    window.getSelection().addRange(range);
    expect(readPage().selection).toBe('Supporting residents with daily living.');
    window.getSelection().removeAllRanges();
  });

  it('caps the size sent', () => {
    expect(readPage(200).html.length).toBe(200);
  });

  it('is self-contained so the browser can inject it', () => {
    const src = readPage.toString();
    expect(src).not.toMatch(/\bimport\b|\brequire\(/);
  });
});
