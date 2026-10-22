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
const ME = (cv_count = 2, my_cv = { id: 9, version_number: 3, updated_at: '2026-10-20T10:00:00Z' }) => [200, { user: USER, role: 'seeker', cv_count, my_cv }];
const TRACK = (status = 'waiting', next = ['applied', 'withdrawn'], applied_on = null) => [200, { id: 9, status, applied_on, next }];

test('not connected: the seeker pitch and Connect', async () => {
  await x.disconnectLocally();
  await x.mockApi({});
  const popup = await x.popup();
  await expect(popup.getByRole('heading', { name: 'Stop applying blindly' })).toBeVisible();
  await expect(popup.locator('#who')).toHaveText('Seeker Login');
  await popup.getByRole('button', { name: 'Connect to ATS Engine' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual([`https://app.ats-engine.com/extension/connect?ext=${SEEKER_ID}`]);
  await popup.close();
});

test('check a job: review, match, requirements, next step, tracker, tailor', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': ME(),
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(),
    'POST /extension/seeker/jobs/55/status': (req) => {
      const to = JSON.parse(req.postData()).status;
      return to === 'applied' ? TRACK('applied', ['interviewing', 'rejected', 'withdrawn'], '2026-10-21') : TRACK(to, ['offer', 'rejected', 'withdrawn'], '2026-10-21');
    },
  });
  const { job, popup } = await x.popupOnJob();
  await expect(popup.locator('#who')).toContainText('Amy Jones');
  await expect(popup.getByText('Your Master CV: version 3, saved 2026-10-20.')).toBeVisible();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await expect(popup.getByRole('heading', { name: 'Is this the job?' })).toBeVisible();
  await expect(popup.getByLabel('Employer')).toHaveValue('Acme Bank');
  await popup.getByRole('button', { name: 'Check my match' }).click();

  await expect(popup.getByText('78%', { exact: true })).toBeVisible();
  await expect(popup.getByRole('img', { name: '78% fit' })).toHaveAttribute('style', '--p:78');
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 600 }), await popup.evaluate(() => window.scrollTo(0, 0)), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-fit.png` });
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

  // Tracker: exactly the moves ATS Engine sent.
  await expect(popup.getByRole('heading', { name: 'Application Tracker' })).toBeVisible();
  await expect(popup.getByText('Waiting', { exact: true })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Got an offer' })).toHaveCount(0);
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1200 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-result.png`, fullPage: true });
  await popup.getByRole('button', { name: "I've applied" }).click();
  await expect(popup.getByText('Marked as applied (2026-10-21).')).toBeVisible();
  await expect(popup.getByRole('button', { name: "I've applied" })).toHaveCount(0);
  await popup.getByRole('button', { name: 'Got an interview' }).click();
  await expect(popup.getByText('Moved to Interview.')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Got an offer' })).toBeVisible();

  // Tailor: CV Creator on this job; nothing changes from the popup.
  await expect(popup.getByText(/saving makes it your active CV \(version 4\)/)).toBeVisible();
  await popup.getByRole('button', { name: 'Tailor my CV for this job' }).click();
  await popup.getByRole('button', { name: 'View full analysis' }).click();
  await popup.getByRole('button', { name: 'Open Application Tracker' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual([
    'https://app.ats-engine.com/my-cv?tailor=55',
    'https://app.ats-engine.com/jobs?open=55',
    'https://app.ats-engine.com/applications',
  ]);
  await Promise.all([job.close(), popup.close()]);
});

test('no Master CV yet: tailoring starts by building it', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({ 'GET /extension/me': ME(2, null), 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()], 'GET /extension/seeker/jobs/55/application': TRACK() });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await popup.getByRole('button', { name: 'Build your Master CV to tailor it' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/my-cv']);
  await Promise.all([job.close(), popup.close()]);
});

test('a move the tracker refuses shows why', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': ME(), 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(),
    'POST /extension/seeker/jobs/55/status': [422, { message: 'Your Application Tracker cannot move this job from applied to applied.', application: { id: 9, status: 'applied', applied_on: '2026-10-19', next: ['interviewing', 'rejected', 'withdrawn'] } }],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await popup.getByRole('button', { name: "I've applied" }).click();
  await expect(popup.getByText(/cannot move this job/)).toBeVisible();
  await expect(popup.getByText('Applied', { exact: true })).toBeVisible();
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
  await expect(popup.getByRole('button', { name: 'Tailor my CV for this job' })).toBeVisible();
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
  await expect(popup.getByText(/use ATS Engine - Recruiters instead/)).toBeVisible();
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

test('a Free account is shown the plans, not the tools', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({ 'GET /extension/me': [402, { error: 'extension_needs_plan', message: 'The ATS Engine browser extension comes with Job Seeker and Job Seeker Pro, and with the 14-day free trial. Upgrade in ATS Engine to use it.' }] });
  const popup = await x.popup();
  await expect(popup.getByRole('heading', { name: 'Part of the paid plans' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Check this job' })).toHaveCount(0);
  await popup.getByRole('button', { name: 'See plans in ATS Engine' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/subscription']);
  await popup.close();
});

// ---- Job Insight (E3): Job Seeker Pro and its trial -------------------------
const PRO_ME = [200, { user: USER, role: 'seeker', cv_count: 2, my_cv: { id: 9, version_number: 3, updated_at: '2026-10-20T10:00:00Z' }, job_insight: true }];
const INSIGHT = {
  scoreable: true, no_cv: false, score: 78, threshold: 70, meets_minimum: true, potential_score: 86,
  verdict: 'A good fit: 78% against your 70% minimum. 2 must-haves are not clearly shown yet.',
  strongest: [{ criterion: 'skills_match', earned: 30, possible: 35, percent: 85.7 }],
  weakest: [{ criterion: 'industry_alignment', earned: 2, possible: 10, percent: 20 }],
  gaps: [
    { skill: 'scrum', band: 'absent', elsewhere: false, fix: 'Nothing on file shows it yet. If you have done it, add it to your CV or as a STAR story.' },
    { skill: 'financial services', band: 'named', elsewhere: true, fix: 'Another of your CVs shows this better - bring it into the CV you send.' },
  ],
  transferable: [{ skill: 'financial services', here: 'named', elsewhere: 'practised' }],
  history: { similar: 4, interviews: 2, offers: 1, summary: "You've applied for 4 similar roles: 2 reached interview, 1 offer." },
  next_step: { kind: 'tailor', title: 'Tailor your CV, then apply', reason: 'A tailored CV would take you from 78% to 86%.', action: { label: 'Tailor my CV' }, destination: '/my-cv?tailor=55' },
};

test('Job Seeker Pro: Job Insight - verdict, next step, strengths, gaps to fix, skills the CV does not show, history', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': PRO_ME,
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(),
    'GET /extension/seeker/jobs/55/insight': [200, INSIGHT],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();

  const card = popup.locator('.pro-card');
  await expect(card.getByRole('heading', { name: 'Job Insight' })).toBeVisible();
  await expect(card).toContainText('A good fit: 78% against your 70% minimum.');
  await expect(card.locator('.next-step')).toContainText('Next: Tailor your CV, then apply');
  await expect(card.getByRole('heading', { name: 'Where you are strong' })).toBeVisible();
  await expect(card).toContainText('Skills match');
  await expect(card).toContainText('30 of 35');
  await expect(card.getByRole('heading', { name: 'Fix these first (2)' })).toBeVisible();
  await expect(card.locator('.pro-list li').first()).toContainText('Scrum');
  await expect(card.getByRole('heading', { name: "You have this - this CV doesn't show it" })).toBeVisible();
  await expect(card.locator('.history')).toHaveText("You've applied for 4 similar roles: 2 reached interview, 1 offer.");
  await expect(popup.locator('#app')).not.toContainText('null');
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1400 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-insight.png`, fullPage: true });
  if (process.env.SHOTS) await card.screenshot({ path: `${process.env.SHOTS}/seeker-insight-card.png` });

  await card.getByRole('button', { name: 'Tailor my CV →' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/my-cv?tailor=55']);
  await Promise.all([job.close(), popup.close()]);
});

test('Job Seeker: Job Insight is sold, with the upgrade one click away', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': ME(),
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(),
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  const card = popup.locator('.pro-card');
  await expect(card.getByRole('heading', { name: 'Know if this job is worth your evening' })).toBeVisible();
  await expect(card).toContainText('free in the 14-day trial');
  await expect(card.locator('.pro-pitch li')).toHaveCount(5);
  expect(x.calls.some((c) => c.path.endsWith('/insight'))).toBe(false); // never asked for
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1300 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-teaser.png`, fullPage: true });
  await card.getByRole('button', { name: 'Upgrade to Job Seeker Pro' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/subscription']);
  await Promise.all([job.close(), popup.close()]);
});
