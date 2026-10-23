/*
 * Loads one real built extension into Chromium with a mocked ATS Engine
 * API and a local job page. Tabs the popup opens are recorded in
 * window.__opened rather than loaded.
 */
import { chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../scripts/build.mjs';

export async function launch(app, jobPageHtml) {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(jobPageHtml);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/jobs/123`;

  const out = mkdtempSync(join(tmpdir(), `ext-e2e-${app}-`));
  build({ app, out });
  const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  m.host_permissions.push('http://127.0.0.1/*'); // in real use activeTab grants this on click
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(m));

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    // Marketing screenshots at 2x (SHOT_SCALE=2); tests ignore it.
    ...(process.env.SHOT_SCALE ? { deviceScaleFactor: Number(process.env.SHOT_SCALE) } : {}),
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  // A freshly started worker can be evaluated before chrome.* is bound.
  for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage?.local))); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const calls = [];

  const h = {
    context, sw, extId, pageUrl, calls,
    async close() {
      await context.close();
      server.close();
    },
    async mockApi(handlers) {
      calls.length = 0;
      await context.unroute('https://api.ats-engine.com/**').catch(() => {});
      await context.route('https://api.ats-engine.com/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname.replace('/api/v1', '');
        calls.push({ method: req.method(), path, body: req.postDataJSON?.() ?? null, auth: req.headers().authorization });
        const hit = handlers[`${req.method()} ${path}`];
        if (!hit) return route.fulfill({ status: 404, json: { message: 'not mocked' } });
        const [status, json] = typeof hit === 'function' ? hit(req) : hit;
        return route.fulfill({ status, json });
      });
    },
    async connectAs(user, role) {
      await sw.evaluate(() => chrome.storage.local.remove('atsEnginePinnedJob')); // each test starts with no job pinned
      await sw.evaluate((c) => chrome.storage.local.set({ atsEngineConnection: c }), {
        token: 'ext-token', role, expires_at: new Date(Date.now() + 86400000).toISOString(), user,
      });
    },
    async disconnectLocally() {
      await sw.evaluate(() => chrome.storage.local.clear());
    },
    async popup(jobTabId = null) {
      const popup = await context.newPage();
      await popup.addInitScript((id) => {
        window.__opened = [];
        chrome.tabs.create = async (props) => {
          window.__opened.push(props.url);
          return { id: -1 };
        };
        if (id !== null) {
          const real = chrome.tabs.query.bind(chrome.tabs);
          chrome.tabs.query = async (q) => (q && q.active ? (await real({})).filter((t) => t.id === id) : real(q));
        }
      }, jobTabId);
      await popup.goto(`chrome-extension://${extId}/popup.html`);
      return popup;
    },
    async popupOnJob() {
      const job = await context.newPage();
      await job.goto(pageUrl);
      const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, pageUrl);
      return { job, popup: await h.popup(tabId) };
    },
  };
  return h;
}
