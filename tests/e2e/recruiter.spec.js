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
  await expect(popup.locator('#who')).toHaveText('Recruiter Login');
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
  await popup.getByRole('button', { name: 'Open Advert Health in ATS Engine' }).click();

  await popup.getByRole('button', { name: 'Job Analysis' }).click();
  await expect(popup.getByRole('heading', { name: 'Essential' })).toBeVisible();
  await expect(popup.locator('.chip', { hasText: 'dementia care' })).toHaveCount(1);
  await expect(popup.getByText("2+ years' experience · Senior level · Leeds · Permanent · £12.50 an hour")).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Skills mentioned' })).toBeVisible();
  await expect(popup.locator('.chip', { hasText: 'medication' })).toHaveCount(1);

  expect(await popup.evaluate(() => window.__opened)).toEqual([
    'https://app.ats-engine.com/recruiter/candidates/501',
    'https://app.ats-engine.com/tools?tab=ad&posting=77&country=GB',
  ]);
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
  await expect(popup.getByText(/use ATS Engine - Seekers instead/)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Capture job' })).toHaveCount(0);
  await popup.close();
});

// ---- ATS Engine Professional (E1, 22 Oct 2026) ------------------------------
const PRO_ME = [200, { user: { name: 'Dennis Nowland', organisation: 'ATS Engine' }, role: 'recruiter', capabilities: ['intelligence_centre', 'intelligence_gaps_advanced', 'intelligence_opportunities', 'intelligence_next_best_action'] }];
const INTEL = {
  vacancy: { id: 77, title: 'Senior Care Assistant', destination: '/jobs?open=77' },
  scoreable: true, threshold: 70, considered: 3, with_cv: 3, limited: false,
  coverage: { suitable: 1, minimum: 3, meets: false, gap: { severity: 'high', title: 'Only 1 suitable candidate - Senior Care Assistant', why: 'A shortlist needs at least 3 people who fit.' } },
  missing_must_haves: { skills: ['nvq level 3'], gap: { why: 'Has to be sourced, or relaxed with the client.' } },
  gaps: [{ id: 9, severity: 'medium', category: 'Advert quality', title: 'Advert has no salary - Senior Care Assistant', why: 'Adverts without pay get fewer applications.', action_label: 'Open vacancy', destination: '/jobs?open=77' }],
  opportunities: { total: 1, threshold: 70, items: [{ candidate_id: 501, name: 'Strong Sam', headline: 'Senior carer', town: 'Leeds', score: 86, matched: ['personal care'], missing: [], destination: '/recruiter/candidates/501' }] },
  next_actions: [
    { key: 'live-match:501', kind: 'opportunity', title: 'Strong Sam for Senior Care Assistant', reason: 'A strong match in your own pool who has not been approached.', priority: { score: 66, band: 'today', parts: [{ label: 'Strong match, not yet approached', points: 50 }, { label: '86 against a pass mark of 70', points: 16 }] }, action: { label: 'Open candidate' }, destination: '/recruiter/candidates/501' },
    { key: 'live:candidate_coverage.few_suitable', kind: 'gap', title: 'Only 1 suitable candidate - Senior Care Assistant', reason: 'A shortlist needs at least 3.', priority: { score: 40, band: 'this_week', parts: [{ label: 'High gap', points: 40 }] }, action: { label: 'Open vacancy' }, destination: '/jobs?open=77' },
  ],
};

test('Professional: Professional insight shows coverage, must-haves, next steps, matches and gaps from ATS Engine', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': PRO_ME,
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/recruiter/jobs': [201, { data: { id: 77, title: 'Senior Care Assistant', location: 'Leeds' } }],
    'GET /extension/recruiter/jobs/77/intelligence': [200, INTEL],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'Create vacancy' }).click();
  await expect(popup.locator('.pro-tease')).toHaveCount(0);

  await popup.getByRole('button', { name: 'Professional insight' }).click();
  await expect(popup.locator('.cover.warn')).toContainText('Only 1 suitable - your desk aims for 3');
  await expect(popup.locator('.chip.warn', { hasText: 'nvq level 3' })).toHaveCount(1);
  await expect(popup.locator('.steps li').first()).toContainText('Today');
  await expect(popup.locator('.steps li').first()).toContainText('66 pts');
  await expect(popup.locator('.steps li').first().locator('.pts')).toHaveAttribute('title', 'Strong match, not yet approached +50 · 86 against a pass mark of 70 +16');
  await expect(popup.getByRole('heading', { name: 'Strong matches not yet approached (1)' })).toBeVisible();
  await expect(popup.locator('.gaplist li')).toContainText('Advert has no salary');
  await expect(popup.locator('#app')).not.toContainText('null');
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1100 }), await popup.screenshot({ path: `${process.env.SHOTS}/pro.png`, fullPage: true });

  await popup.locator('.steps li').first().getByRole('button', { name: 'Open candidate →' }).click();
  await popup.locator('.gaplist li').first().getByRole('button', { name: 'Open vacancy →' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual([
    'https://app.ats-engine.com/recruiter/candidates/501',
    'https://app.ats-engine.com/jobs?open=77',
  ]);
  await Promise.all([job.close(), popup.close()]);
});

test('Standard: no Professional button, a teaser instead, and its own tools as before', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': ME,
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/recruiter/jobs': [201, { data: { id: 77, title: 'Senior Care Assistant' } }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'Create vacancy' }).click();
  await expect(popup.getByRole('button', { name: 'Professional insight' })).toHaveCount(0);
  await expect(popup.locator('.pro-tease')).toContainText('With ATS Engine Professional');
  await expect(popup.getByRole('button', { name: 'Match my database' })).toBeVisible();
  await Promise.all([job.close(), popup.close()]);
});

test('Professional refused by the server (e.g. just downgraded): the offer, not an error', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': PRO_ME,
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/recruiter/jobs': [201, { data: { id: 77, title: 'Senior Care Assistant' } }],
    'GET /extension/recruiter/jobs/77/intelligence': [402, { error: 'plan_feature_unavailable', message: 'This is part of ATS Engine Professional.' }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'Create vacancy' }).click();
  await popup.getByRole('button', { name: 'Professional insight' }).click();
  await expect(popup.getByRole('heading', { name: 'Part of ATS Engine Professional' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Capture another job' })).toBeVisible(); // still on the vacancy
  await Promise.all([job.close(), popup.close()]);
});

test('Professional: long lists are shown three at a time with Previous and Next', async () => {
  const gaps = Array.from({ length: 7 }, (_, i) => ({ id: 100 + i, severity: 'high', category: 'Expiry', title: `Gap number ${i + 1}`, why: 'Why it matters.', action_label: 'Open', destination: `/recruiter/candidates/${i + 1}` }));
  await connectAs();
  await mockApi({
    'GET /extension/me': PRO_ME,
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/recruiter/jobs': [201, { data: { id: 77, title: 'Senior Care Assistant' } }],
    'GET /extension/recruiter/jobs/77/intelligence': [200, { ...INTEL, gaps }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'Create vacancy' }).click();
  await popup.getByRole('button', { name: 'Professional insight' }).click();

  const nav = popup.getByRole('navigation', { name: 'Open gaps pages' });
  await expect(popup.locator('.gaplist li')).toHaveCount(3);
  await expect(nav).toContainText('1-3 of 7');
  await expect(nav.getByRole('button', { name: '‹ Previous' })).toBeDisabled();
  await nav.getByRole('button', { name: 'Next ›' }).click();
  await expect(popup.locator('.gaplist li').first()).toContainText('Gap number 4');
  await nav.getByRole('button', { name: 'Next ›' }).click();
  await expect(nav).toContainText('7-7 of 7');
  await expect(nav.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  // Two next steps fit on one page: no pager for them.
  await expect(popup.getByRole('navigation', { name: 'Next steps pages' })).toHaveCount(0);
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1100 }), await popup.screenshot({ path: `${process.env.SHOTS}/pro-paged.png`, fullPage: true });
  await Promise.all([job.close(), popup.close()]);
});

// ---- E2: a candidate on another site -----------------------------------------
const CAND_CAPTURE = { fields: { full_name: 'Priya Shah', email: 'priya.shah@example.com', phone: '07700 900123', headline: null, town: null, profile_text: 'Senior care assistant. Personal care.', source_url: 'http://127.0.0.1/jobs/123', source_site: '127.0.0.1' }, not_found: [], used_selection: false };
const NEW_CTX = {
  possible_matches: [], known: null, scoreable: true, threshold: 70, scored_from: 'page', fit_total: 1, scored_against: 2,
  best_fit: [{ id: 77, title: 'Senior Care Assistant', client: 'Example Care', score: 84, matched: ['personal care'], missing: [], already: false, destination: '/jobs?open=77' }],
  next_actions: [{ key: 'fit:77', kind: 'opportunity', title: 'Priya Shah for Senior Care Assistant', reason: 'A strong match for this vacancy. Add them to your Talent Pool first to put them forward.', priority: { score: 64, band: 'today', parts: [{ label: 'Strong match, not yet approached', points: 50 }, { label: '84 against a pass mark of 70', points: 14 }] }, action: { label: 'Open vacancy' }, destination: '/jobs?open=77' }],
};

test('Professional: capture a new candidate, see where they fit, and add them only after confirming', async () => {
  let added = null;
  await connectAs();
  await mockApi({
    'GET /extension/me': PRO_ME,
    'POST /extension/recruiter/candidates/capture': [200, CAND_CAPTURE],
    'POST /extension/recruiter/candidates/context': [200, NEW_CTX],
    'POST /extension/recruiter/candidates': (req) => ((added = req.postDataJSON()), [201, { candidate: { id: 900 } }]),
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture candidate' }).click();
  await expect(popup.locator('#c-full_name')).toHaveValue('Priya Shah');
  await popup.locator('#c-town').fill('Leeds');
  await popup.getByRole('button', { name: 'Check against ATS Engine' }).click();

  await expect(popup.locator('.cover.warn')).toContainText('Not in your Talent Pool yet');
  await expect(popup.getByRole('heading', { name: 'Where they fit (1)' })).toBeVisible();
  await expect(popup.locator('.pro-list li').first()).toContainText('84%');
  await expect(popup.locator('.steps li').first()).toContainText('64 pts');
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1100 }), await popup.screenshot({ path: `${process.env.SHOTS}/candidate-new.png`, fullPage: true });

  await popup.getByRole('button', { name: 'Add to Talent Pool' }).click();
  expect(added).toBeNull(); // nothing sent before the confirmation
  await expect(popup.locator('.confirm')).toContainText('Priya Shah · priya.shah@example.com · 07700 900123 · Leeds');
  await popup.getByRole('button', { name: 'Yes, add them' }).click();
  await expect(popup.getByText('Priya Shah is in your Talent Pool.')).toBeVisible();
  expect(added).toMatchObject({ full_name: 'Priya Shah', email: 'priya.shah@example.com', town: 'Leeds', confirmed: true });
  await popup.getByRole('button', { name: 'Open their record →' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/recruiter/candidates/900']);
  await Promise.all([job.close(), popup.close()]);
});

test('Professional: someone already here shows their history, and there is no Add button', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': PRO_ME,
    'POST /extension/recruiter/candidates/capture': [200, CAND_CAPTURE],
    'POST /extension/recruiter/candidates/context': [200, {
      ...NEW_CTX, scored_from: 'record',
      possible_matches: [{ id: 5, name: 'Priya Shah', reason: 'same_email', applications: 2, live: 1, destination: '/recruiter/candidates/5' }],
      known: { id: 5, name: 'Priya Shah', destination: '/recruiter/candidates/5', submissions: 1, opportunities: 0, gaps: [{ id: 3, severity: 'critical', title: 'DBS expired - Priya Shah', why: 'May not be placed.', action_label: 'Open candidate', destination: '/recruiter/candidates/5' }],
        applications: [{ role: 'Care Assistant', company: 'Acme Care', status: 'interviewing', applied_on: '2026-10-01', destination: '/jobs?open=12' }] },
    }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture candidate' }).click();
  await popup.getByRole('button', { name: 'Check against ATS Engine' }).click();
  await expect(popup.locator('.cover.ok')).toContainText('Priya Shah is already in your Talent Pool');
  await expect(popup.getByRole('heading', { name: 'Their applications (1)' })).toBeVisible();
  await expect(popup.locator('.pro-list li', { hasText: 'Acme Care' })).toContainText('Interviewing');
  await expect(popup.getByRole('heading', { name: 'Their open gaps (1)' })).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Could be the same person' })).toHaveCount(0);
  await expect(popup.getByRole('button', { name: 'Add to Talent Pool' })).toHaveCount(0);
  await Promise.all([job.close(), popup.close()]);
});

test('Standard: no Capture candidate', async () => {
  await connectAs();
  await mockApi({ 'GET /extension/me': ME });
  const { job, popup } = await openPopup();
  await expect(popup.getByRole('button', { name: 'Capture job' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Capture candidate' })).toHaveCount(0);
  await Promise.all([job.close(), popup.close()]);
});

test('a refused site (LinkedIn) is explained, not shown as broken', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': PRO_ME,
    'POST /extension/recruiter/candidates/capture': [422, { error: 'site_not_allowed', message: "ATS Engine doesn't read candidates from www.linkedin.com: its terms don't allow pages to be read automatically. Add the person from your Talent Pool instead." }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture candidate' }).click();
  await expect(popup.locator('.notice.bad')).toContainText("doesn't read candidates from www.linkedin.com");
  await expect(popup.getByRole('button', { name: 'Capture job' })).toBeVisible();
  await Promise.all([job.close(), popup.close()]);
});

// ---- Opening in ATS Engine (22 Oct 2026) -------------------------------------
test('View existing is a button that opens Job Postings on that card', async () => {
  await connectAs();
  await mockApi({
    'GET /extension/me': [200, ME[1]],
    'POST /extension/capture': [200, { ...CAPTURED, existing: [{ id: 12, title: 'Senior Care Assistant', company: 'Acme Care', location: 'Leeds', status: 'open', reason: 'same_link' }] }],
  });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByRole('button', { name: 'View existing →' }).click();
  await popup.getByRole('button', { name: 'Open the existing one in ATS Engine' }).click();
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 700 }), await popup.screenshot({ path: `${process.env.SHOTS}/duplicate-buttons.png`, fullPage: true });
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/jobs?open=12', 'https://app.ats-engine.com/jobs?open=12']);
  await Promise.all([job.close(), popup.close()]);
});

test('not added yet: Open in ATS Engine hands the reviewed fields to the Add a vacancy form, in the fragment', async () => {
  await connectAs();
  let saved = false;
  await mockApi({ 'GET /extension/me': [200, ME[1]], 'POST /extension/capture': [200, CAPTURED], 'POST /extension/recruiter/jobs': () => ((saved = true), [201, { data: { id: 1 } }]) });
  const { job, popup } = await openPopup();
  await popup.getByRole('button', { name: 'Capture job' }).click();
  await popup.getByLabel('Salary').fill('£13 an hour');
  await popup.getByRole('button', { name: 'Open in ATS Engine to finish there' }).click();
  const [url] = await popup.evaluate(() => window.__opened);
  expect(url.startsWith('https://app.ats-engine.com/jobs#prefill=')).toBe(true);
  const b64 = url.split('#prefill=')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  expect(json).toMatchObject({ title: 'Senior Care Assistant', company: 'Acme Care', salary: '£13 an hour', source_url: 'http://127.0.0.1/jobs/123' });
  expect(saved).toBe(false); // nothing saved
  await Promise.all([job.close(), popup.close()]);
});
