/*
 * End to end: the real job seeker extension in Chromium, mocked API.
 * Connect; Check this job -> review -> Check my match -> the result
 * ATS Engine returned (score, requirements, next step) -> I've applied;
 * no CV; a job with no readable requirements; a recruiter account.
 */
import { test, expect } from '@playwright/test';
import { launch } from './harness.js';

const JOB_PAGE = `<!doctype html><html><head><title>Delivery Manager | Acme Bank | LinkedIn</title></head>
<body><h1>Delivery Manager</h1><p>Acme Bank, Edinburgh.</p></body></html>`;
const SEEKER_ID = 'fbpbkfikiogmljdnojhnhgfobinecgbm';
const USER = { name: 'Amy Jones', organisation: 'Amy Jones' };

let x;
test.beforeAll(async () => {
  x = await launch('seeker', JOB_PAGE);
  expect(x.extId).toBe(SEEKER_ID);
});
test.afterAll(async () => x?.close());

const CAPTURED = {
  status: 'harvested',
  is_job_page: true,
  fields: { title: 'Delivery Manager', company: 'Acme Bank', location: 'Edinburgh', description: 'Lead agile delivery for payments teams. Scrum, stakeholder management, financial services.', source_site: 'www.linkedin.com', source_url: 'https://www.linkedin.com/jobs/view/1' },
  not_found: ['salary', 'job_type', 'hours'],
  warnings: [],
  existing: [],
};
const FIT = {
  score: 78, scoreable: true, band: 'green', meets_minimum: true, minimum_score_threshold: 70,
  requirement_evidence: [
    { skill: 'agile delivery', band: 'evidenced' },
    { skill: 'stakeholder management', band: 'practised' },
    { skill: 'scrum', band: 'named' },
    { skill: 'financial services', band: 'absent' },
  ],
  best_cv: { id: 4, filename: 'Amy Jones CV.docx', of: 2 },
  tailoring_can_meet_minimum: true, potential_score: 84,
};
const JOB = (fit = FIT, application = { id: 9, status: 'waiting', applied_on: null }) => ({ data: { id: 55, title: 'Delivery Manager', company: 'Acme Bank', candidate_fit: fit, application } });
const ME = (cv_count = 2) => [200, { user: USER, role: 'seeker', cv_count }];

test('not connected: the seeker pitch and Connect', async () => {
  await x.disconnectLocally();
  await x.mockApi({});
  const popup = await x.popup();
  await expect(popup.getByRole('heading', { name: 'Stop applying blindly' })).toBeVisible();
  await popup.getByRole('button', { name: 'Connect to ATS Engine' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual([`https://app.ats-engine.com/extension/connect?ext=${SEEKER_ID}`]);
  await popup.close();
});

test('check a job: review, match, requirements, next step, then I have applied', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': ME(),
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/seeker/jobs': [201, JOB()],
    'POST /extension/seeker/jobs/55/applied': [200, { id: 9, status: 'applied', applied_on: '2026-10-21', already: false }],
  });
  const { job, popup } = await x.popupOnJob();
  await expect(popup.locator('#who')).toContainText('Amy Jones');
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await expect(popup.getByRole('heading', { name: 'Is this the job?' })).toBeVisible();
  await expect(popup.getByLabel('Employer')).toHaveValue('Acme Bank');
  await popup.getByRole('button', { name: 'Check my match' }).click();

  await expect(popup.getByText('78%')).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Worth applying' })).toBeVisible();
  await expect(popup.getByText('2 requirements evidenced')).toBeVisible();
  await expect(popup.getByText('2 to strengthen')).toBeVisible();
  await expect(popup.getByText('Before you apply, consider strengthening: Scrum, Financial services.')).toBeVisible();
  await expect(popup.locator('.reqs li').first()).toContainText('Agile delivery');
  await expect(popup.locator('.reqs li').last()).toContainText('✕ Not evidenced');
  await expect(popup.getByText('Matched against Amy Jones CV.docx (the best fit of your 2 CVs)')).toBeVisible();
  await expect(popup.locator('#app')).not.toContainText('null');

  const sent = x.calls.find((c) => c.path === '/extension/seeker/jobs');
  expect(sent.auth).toBe('Bearer ext-token');
  expect(sent.body).toMatchObject({ title: 'Delivery Manager', company: 'Acme Bank' });
  expect(sent.body.salary).toBeUndefined();

  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 980 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-result.png`, fullPage: true });

  await popup.getByRole('button', { name: "I've applied" }).click();
  await expect(popup.getByText('Marked as applied today (2026-10-21) in your Application Tracker.')).toBeVisible();
  await expect(popup.getByRole('button', { name: "I've applied" })).toHaveCount(0);

  await popup.getByRole('button', { name: 'View full analysis' }).click();
  await popup.getByRole('button', { name: 'Tailor my CV' }).click();
  await popup.getByRole('button', { name: 'Application Tracker' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual([
    'https://app.ats-engine.com/jobs?open=55',
    'https://app.ats-engine.com/jobs?open=55',
    'https://app.ats-engine.com/applications',
  ]);
  await Promise.all([job.close(), popup.close()]);
});

test('below the minimum but tailoring can reach it: Tailor first', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({ 'GET /extension/me': ME(), 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [200, JOB({ ...FIT, score: 61, band: 'yellow', meets_minimum: false })] });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.getByRole('heading', { name: 'Tailor your CV first' })).toBeVisible();
  await expect(popup.getByText(/would take it to 84%/)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Tailor my CV in ATS Engine' })).toBeVisible();
  await Promise.all([job.close(), popup.close()]);
});

test('requirements ATS Engine could not read: no score, never 0%', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({ 'GET /extension/me': ME(), 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB({ ...FIT, score: 0, scoreable: false, requirement_evidence: [] })] });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.getByText('No score', { exact: true })).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'No score for this one yet' })).toBeVisible();
  await expect(popup.locator('#app')).not.toContainText('0%');
  await Promise.all([job.close(), popup.close()]);
});

test('no CV yet: upload first', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({ 'GET /extension/me': ME(0) });
  const popup = await x.popup();
  await expect(popup.getByRole('heading', { name: 'Add your CV first' })).toBeVisible();
  await popup.getByRole('button', { name: 'Upload your CV' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/cv-library']);
  await popup.close();
});

test('a recruiter account is pointed to the recruiter extension', async () => {
  await x.connectAs(USER, 'recruiter');
  await x.mockApi({ 'GET /extension/me': [200, { user: USER, role: 'recruiter', cv_count: null }] });
  const popup = await x.popup();
  await expect(popup.getByText(/use ATS Engine for Recruiters instead/)).toBeVisible();
  await popup.close();
});

test('page text is shown as text, never run', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': ME(),
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/seeker/jobs': [201, { data: { ...JOB().data, title: '<img src=x onerror="window.__pwned=1">', candidate_fit: { ...FIT, requirement_evidence: [{ skill: '<b>x</b>', band: 'absent' }] } } }],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.locator('.reqs li').first()).toContainText('<b>x</b>');
  expect(await popup.evaluate(() => window.__pwned)).toBeUndefined();
  await Promise.all([job.close(), popup.close()]);
});
