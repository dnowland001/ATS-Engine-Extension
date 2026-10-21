/*
 * End to end: the real built extension, loaded into Chromium, against a
 * mocked ATS Engine API. Covers: not connected -> Connect; capture a job
 * page -> review -> Create vacancy; a possible duplicate -> Update this
 * one; a non-job page; an expired connection.
 */
import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../scripts/build.mjs';

const JOB_PAGE = `<!doctype html><html><head><title>Senior Care Assistant</title></head>
<body><h1>Senior Care Assistant</h1><p>Acme Care, Leeds. £12.50 an hour.</p></body></html>`;

let server, pageUrl, context, extId, sw, apiCalls;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(JOB_PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  pageUrl = `http://127.0.0.1:${server.address().port}/jobs/123`;

  // The real production build, plus permission to read the local test page
  // (in normal use activeTab grants that when the recruiter clicks).
  const out = mkdtempSync(join(tmpdir(), 'ext-e2e-'));
  build({ app: 'recruiter', out });
  const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  m.host_permissions.push('http://127.0.0.1/*');
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(m));

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    // CHROMIUM_PATH points at a Chromium already on the machine (CI images, containers).
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extId = new URL(sw.url()).host;
  // A freshly started worker can be evaluated before chrome.* is bound.
  for (let i = 0; i < 50 && !(await sw.evaluate(() => Boolean(globalThis.chrome?.storage?.local))); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(extId).toBe('fmgfdjfhhjdkciahjdlgiefgelffglml'); // fixed by the manifest key
});

test.afterAll(async () => {
  await context?.close();
  server?.close();
});

test.beforeEach(async () => {
  apiCalls = [];
  await context.unroute('https://api.ats-engine.com/**').catch(() => {});
});

async function mockApi(handlers) {
  await context.route('https://api.ats-engine.com/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    apiCalls.push({ method: req.method(), path, body: req.postDataJSON?.() ?? null, auth: req.headers().authorization });
    const h = handlers[`${req.method()} ${path}`];
    if (!h) return route.fulfill({ status: 404, json: { message: 'not mocked' } });
    const [status, json] = typeof h === 'function' ? h(req) : h;
    return route.fulfill({ status, json });
  });
}

async function connectAs(user = { name: 'Dennis Nowland', organisation: 'ATS Engine' }) {
  await sw.evaluate(
    (c) => chrome.storage.local.set({ atsEngineConnection: c }),
    { token: 'ext-token', role: 'recruiter', expires_at: new Date(Date.now() + 86400000).toISOString(), user },
  );
}

async function disconnectLocally() {
  await sw.evaluate(() => chrome.storage.local.clear());
}

/**
 * The popup, as clicking the toolbar icon opens it. Tabs it asks to open
 * are recorded in window.__opened rather than loaded (this machine has no
 * route to ATS Engine). With a job tab, "the active tab" is that tab.
 */
async function newPopup(jobTabId = null) {
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
}

/** Opens the job page, then the popup pointed at it. */
async function openPopup() {
  const job = await context.newPage();
  await job.goto(pageUrl);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, pageUrl);
  return { job, popup: await newPopup(tabId) };
}

const ME = [200, { user: { name: 'Dennis Nowland', organisation: 'ATS Engine' }, role: 'recruiter' }];
const CAPTURED = {
  status: 'ok',
  is_job_page: true,
  fields: { title: 'Senior Care Assistant', company: 'Acme Care', location: 'Leeds', salary: '£12.50 an hour', description: 'Supporting residents with daily living and personal care.', source_url: 'http://127.0.0.1/jobs/123', source_site: '127.0.0.1' },
  not_found: ['job_type', 'hours'],
  warnings: [],
  existing: [],
};

test('not connected: offers Connect, which opens the ATS Engine connect page', async () => {
  await disconnectLocally();
  await mockApi({});
  const popup = await newPopup();
  await expect(popup.getByRole('button', { name: 'Connect to ATS Engine' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Disconnect' })).toBeHidden();
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 420 }), await popup.screenshot({ path: `${process.env.SHOTS}/connect.png` });
  await popup.getByRole('button', { name: 'Connect to ATS Engine' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual([`https://app.ats-engine.com/extension/connect?ext=${extId}`]);
  await popup.close();
});

test('captures a job, shows what was not found, and creates the vacancy', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': [200, ME[1]],
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/recruiter/jobs': [201, { data: { id: 77, title: 'Senior Care Assistant', location: 'Leeds' } }],
  });
  const { job, popup } = await openPopup();
  await expect(popup.locator('#who')).toContainText('Dennis Nowland');
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await expect(popup.getByRole('heading', { name: 'Job captured' })).toBeVisible();
  await expect(popup.getByLabel('Job title')).toHaveValue('Senior Care Assistant');
  await expect(popup.getByText('2 not on the page')).toBeVisible();
  await expect(popup.locator('#app')).not.toContainText('null');
  await expect(popup.getByLabel('Contract type')).toHaveAttribute('placeholder', 'Not found on the page');

  const capture = apiCalls.find((c) => c.path === '/extension/capture');
  expect(capture.auth).toBe('Bearer ext-token');
  expect(capture.body.html).toContain('Senior Care Assistant');
  expect(capture.body.url).toBe(pageUrl);

  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 900 }), await popup.screenshot({ path: `${process.env.SHOTS}/review.png`, fullPage: true });
  await popup.getByLabel('Contract type').fill('Permanent');
  await popup.getByRole('button', { name: 'Create vacancy' }).click();
  await expect(popup.getByRole('heading', { name: 'Vacancy created' })).toBeVisible();
  const created = apiCalls.find((c) => c.path === '/extension/recruiter/jobs');
  expect(created.body).toMatchObject({ title: 'Senior Care Assistant', company: 'Acme Care', job_type: 'Permanent' });
  expect(created.body.hours).toBeUndefined();
  expect(created.body.create_new).toBeUndefined();

  if (process.env.SHOTS) await popup.screenshot({ path: `${process.env.SHOTS}/done.png` });
  await popup.getByRole('button', { name: 'Open in ATS Engine' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/jobs?open=77']);
  await Promise.all([job.close(), popup.close()]);
});

const MATCH = {
  scoreable: true, threshold: 70, considered: 3, with_cv: 3, limited: false,
  counts: { green: 1, yellow: 1, red: 1 },
  top: [
    { id: 501, name: 'Strong Sam', headline: 'Senior Care Assistant', location: 'Leeds', score: 86, band: 'green', meets_minimum: true },
    { id: 502, name: 'Close Cara', headline: null, location: 'York', score: 64, band: 'yellow', meets_minimum: false },
    { id: 503, name: 'Will', headline: 'Developer', location: null, score: 12, band: 'red', meets_minimum: false },
  ],
};
const HEALTH = {
  country: 'GB', overall_score: 82,
  categories: {
    attraction: [{ id: 'salary', label: 'Salary stated', status: 'pass', suggestions: [] }],
    clarity: [{ id: 'reqs', label: 'Requirement count', status: 'warn', suggestions: ['Cut the essentials to the ones that matter.'] }],
    risk: [{ id: 'health', label: 'Health questions', status: 'not_applicable', suggestions: [] }],
  },
  improvements: [{ label: 'Requirement count', suggestions: ['Cut the essentials to the ones that matter.'] }],
};
const ANALYSIS = { id: 77, title: 'Senior Care Assistant', location: 'Leeds', salary: '£12.50 an hour', job_type: 'Permanent', hours: null, seniority: 'senior', years_experience_required: 2, must_have: ['personal care', 'dementia care'], nice_to_have: ['nvq level 3'], skills: ['personal care', 'dementia care', 'medication'] };

test('after saving: Match my database, Advert Health and Job Analysis from ATS Engine', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': [200, ME[1]],
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/recruiter/jobs': [201, { data: { id: 77, title: 'Senior Care Assistant', location: 'Leeds' } }],
    'POST /extension/recruiter/jobs/77/match-database': [200, MATCH],
    'POST /extension/recruiter/jobs/77/advert-health': [200, HEALTH],
    'GET /extension/recruiter/jobs/77/analysis': [200, ANALYSIS],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'Create vacancy' }).click();

  await popup.getByRole('button', { name: 'Match my database' }).click();
  await expect(popup.getByRole('heading', { name: '3 candidates matched' })).toBeVisible();
  await expect(popup.locator('.bandrow.green')).toContainText('1Meet your 70% minimum');
  await expect(popup.locator('.people li').first()).toContainText('86%');
  await expect(popup.locator('.people li').first()).toContainText('Strong Sam');
  await expect(popup.locator('#app')).not.toContainText('null');
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 900 }), await popup.screenshot({ path: `${process.env.SHOTS}/match.png`, fullPage: true });
  await popup.locator('.people li').first().getByRole('button', { name: 'View' }).click();

  await popup.getByRole('button', { name: 'Advert Health' }).click();
  await expect(popup.getByRole('heading', { name: 'Advert Health' })).toBeVisible();
  await expect(popup.locator('.num')).toHaveText('82');
  await expect(popup.locator('.reqs li')).toHaveCount(2); // not-applicable left out
  await expect(popup.getByText('Warnings are things to review, not legal findings.')).toBeVisible();
  if (process.env.SHOTS) await popup.screenshot({ path: `${process.env.SHOTS}/health.png`, fullPage: true });

  await popup.getByRole('button', { name: 'Job Analysis' }).click();
  await expect(popup.getByRole('heading', { name: 'Essential' })).toBeVisible();
  await expect(popup.locator('.chip', { hasText: 'dementia care' })).toHaveCount(1);
  await expect(popup.getByText("2+ years' experience · Senior level · Leeds · Permanent · £12.50 an hour")).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Skills mentioned' })).toBeVisible();
  await expect(popup.locator('.chip', { hasText: 'medication' })).toHaveCount(1);

  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/recruiter/candidates/501']);
  await Promise.all([job.close(), popup.close()]);
});

test('an error from one of them shows in place and the rest still work', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': [200, ME[1]],
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/recruiter/jobs': [201, { data: { id: 77, title: 'Senior Care Assistant' } }],
    'POST /extension/recruiter/jobs/77/advert-health': [422, { message: 'That is only 12 words.' }],
    'POST /extension/recruiter/jobs/77/match-database': [200, { scoreable: false, threshold: 70, considered: 0, with_cv: 4, counts: {}, top: [] }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'Create vacancy' }).click();
  await popup.getByRole('button', { name: 'Advert Health' }).click();
  await expect(popup.getByText('That is only 12 words.')).toBeVisible();
  await popup.getByRole('button', { name: 'Match my database' }).click();
  await expect(popup.getByRole('heading', { name: 'Nothing to match on yet' })).toBeVisible();
  await Promise.all([job.close(), popup.close()]);
});

test('will not save without the required fields', async () => {
  await connectAs();
  await mockApi({ 'GET /extension/me': [200, ME[1]], 'POST /extension/capture': [200, { ...CAPTURED, fields: { ...CAPTURED.fields, company: '' } }] });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'Create vacancy' }).click();
  await expect(popup.getByText('Add Employer before saving.')).toBeVisible();
  expect(apiCalls.some((c) => c.path === '/extension/recruiter/jobs')).toBe(false);
  await Promise.all([job.close(), popup.close()]);
});

test('a possible duplicate: Update this one fills the existing vacancy', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': [200, ME[1]],
    'POST /extension/capture': [200, { ...CAPTURED, existing: [{ id: 12, title: 'Senior Care Assistant', company: 'Acme Care', location: 'Leeds', status: 'open', reason: 'same_title_and_employer' }] }],
    'POST /extension/recruiter/jobs/12/fill': [200, { data: { id: 12, title: 'Senior Care Assistant', _dedup_status: 'updated' } }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await expect(popup.getByRole('heading', { name: 'Possible duplicate' })).toBeVisible();
  await expect(popup.getByText('Same title and employer')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Create vacancy', exact: true })).toHaveCount(0);
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 700 }), await popup.screenshot({ path: `${process.env.SHOTS}/duplicate.png` });
  await popup.getByRole('button', { name: 'Update this one' }).click();
  await expect(popup.getByRole('heading', { name: 'Vacancy updated' })).toBeVisible();
  await Promise.all([job.close(), popup.close()]);
});

test('a page that is not a job advert says so', async () => {
  await connectAs();
  await mockApi({ 'GET /extension/me': [200, ME[1]], 'POST /extension/capture': [200, { ...CAPTURED, is_job_page: false, fields: { source_url: pageUrl, source_site: '127.0.0.1' }, not_found: [] }] });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await expect(popup.getByText('This does not look like a job advert.')).toBeVisible();
  await Promise.all([job.close(), popup.close()]);
});

test('an ended connection goes back to Connect and is forgotten', async () => {
  await connectAs();
  await mockApi({ 'GET /extension/me': [401, { message: 'Unauthenticated.' }] });
  const popup = await newPopup();
  await expect(popup.getByText('Your connection to ATS Engine has ended.')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Connect to ATS Engine' })).toBeVisible();
  expect(await sw.evaluate(() => chrome.storage.local.get('atsEngineConnection'))).toEqual({});
  await popup.close();
});

test('page text from the advert is shown as text, never run', async () => {
  await connectAs();
  await mockApi({ 'GET /extension/me': [200, ME[1]], 'POST /extension/capture': [200, { ...CAPTURED, fields: { ...CAPTURED.fields, company: '<img src=x onerror="window.__pwned=1">' }, warnings: ['<b>bold</b>'] }] });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await expect(popup.getByText('<b>bold</b>')).toBeVisible();
  await expect(popup.getByLabel('Employer')).toHaveValue('<img src=x onerror="window.__pwned=1">');
  expect(await popup.evaluate(() => window.__pwned)).toBeUndefined();
  await Promise.all([job.close(), popup.close()]);
});

test('a job seeker account is pointed to the job seeker extension', async () => {
  await connectAs({ name: 'Amy', organisation: 'Amy' });
  await mockApi({ 'GET /extension/me': [200, { user: { name: 'Amy' }, role: 'seeker', cv_count: 1 }] });
  const popup = await newPopup();
  await expect(popup.getByText(/use ATS Engine for Job Seekers instead/)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Capture job' })).toHaveCount(0);
  await popup.close();
});
