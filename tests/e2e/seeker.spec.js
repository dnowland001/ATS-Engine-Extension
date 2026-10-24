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
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => iso(new Date(Date.now() + n * 86400000));
const TRACK = (status = 'waiting', next = ['applied', 'withdrawn'], applied_on = null, extra = {}) => [200, { id: 9, status, applied_on, next, checked_on: day(0), follow_up_on: applied_on ? day(7) : null, ...extra }];

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
      return to === 'applied' ? TRACK('applied', ['interviewing', 'rejected', 'withdrawn'], day(0)) : TRACK(to, ['offer', 'rejected', 'withdrawn'], day(0));
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
  await expect(popup.getByRole('heading', { name: 'Apply for this job' })).toBeVisible();
  await expect(popup.locator('.journey .jstep')).toHaveCount(3);
  await expect(popup.locator('.jstep.current .jlabel')).toHaveText('Applied');
  await expect(popup.getByText('Waiting', { exact: true })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Got an offer' })).toHaveCount(0);
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1200 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-result.png`, fullPage: true });
  await popup.getByRole('button', { name: "I've applied" }).click();
  await expect(popup.getByText(/Marked as applied on .* Good luck!/)).toBeVisible();
  await expect(popup.getByText(/ATS Engine will remind you on .* \(in 7 days\)\./)).toBeVisible();
  await expect(popup.getByRole('button', { name: '1 week' })).toHaveAttribute('aria-pressed', 'true');
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
  await expect(popup.locator('.tracker-line .pill')).toHaveText('Applied');
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

  const card = popup.locator('.pro-card:not(.advert-card):not(.company-card)');
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
  await expect(card.locator('.pro-pitch li')).toHaveCount(9); // Job Insight's five, applying's three and the company snapshot
  expect(x.calls.some((c) => c.path.endsWith('/insight'))).toBe(false); // never asked for
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 1300 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-teaser.png`, fullPage: true });
  await card.getByRole('button', { name: 'Upgrade to Job Seeker Pro' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/subscription']);
  await Promise.all([job.close(), popup.close()]);
});

// ---- The full fit (22 Oct 2026) ------------------------------------------------
const DOC_ME = [200, { user: USER, role: 'seeker', cv_count: 2, my_cv: null, candidate_id: 7, documents: true }];
const TAILORED = { ...FIT, tailored: { document_id: 900, score: 86, source_score: 78, improved_or_equal: true } };

test('a job already in their ATS Engine shows its fit straight away, without checking it again', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': DOC_ME,
    'POST /extension/capture': [200, { ...CAPTURED, existing: [{ id: 55, title: 'Delivery Manager', company: 'Acme Bank', reason: 'same_link' }] }],
    'GET /extension/seeker/jobs/55': [200, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(),
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await expect(popup.getByText('This job is already in your ATS Engine - here is your fit, and where your application is.')).toBeVisible();
  await expect(popup.getByRole('img', { name: '78% fit' })).toBeVisible();
  await expect(popup.locator('.fullfit.is-first')).toContainText('Before the full analysis');
  expect(x.calls.some((c) => c.method === 'POST' && c.path === '/extension/seeker/jobs')).toBe(false);
  await expect(popup.getByRole('button', { name: 'Check it again from this page' })).toBeVisible();
  await Promise.all([job.close(), popup.close()]);
});

test('with a tailored CV the ring is the full fit, with the best CV beside it, and Download', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': DOC_ME,
    'POST /extension/capture': [200, { ...CAPTURED, existing: [{ id: 55, title: 'Delivery Manager' }] }],
    'GET /extension/seeker/jobs/55': [200, JOB(TAILORED)],
    'GET /extension/seeker/jobs/55/application': TRACK(),
    'GET /extension/seeker/documents/900/download': [200, { file: 'docx' }],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await expect(popup.getByRole('img', { name: '86% fit, tailored CV' })).toBeVisible();
  await expect(popup.locator('.fit-word')).toHaveText('full fit');
  await expect(popup.locator('.fullfit.is-full')).toContainText('Your tailored CV scores 86% - your best CV on its own scored 78% (+8).');
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 640 }), await popup.evaluate(() => window.scrollTo(0, 0)), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-fullfit.png` });
  await popup.getByRole('button', { name: 'Download tailored CV' }).click();
  await expect.poll(() => x.calls.some((c) => c.path === '/extension/seeker/documents/900/download')).toBe(true);
  await Promise.all([job.close(), popup.close()]);
});

test('before the full analysis: make the tailored CV here, then the full fit and Download appear', async () => {
  let made = false;
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': DOC_ME,
    'POST /extension/capture': [200, CAPTURED],
    'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(),
    'POST /extension/seeker/documents/generate': (req) => ((made = req.postDataJSON()), [202, { data: { id: 900, status: 'pending' } }]),
    'GET /extension/seeker/documents/900': [200, { data: { id: 900, status: 'evidence_checked' } }],
    'GET /extension/seeker/jobs/55': [200, JOB(TAILORED)],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.locator('.fullfit.is-first')).toContainText("This is your best CV's fit before it is tailored to this job.");
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 640 }), await popup.evaluate(() => window.scrollTo(0, 0)), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-beforefull.png` });
  await popup.getByRole('button', { name: 'Make my tailored CV - full analysis' }).click();
  await expect(popup.getByText('Making your tailored CV for this job')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Download tailored CV' })).toBeVisible({ timeout: 10000 });
  await expect(popup.getByRole('img', { name: '86% fit, tailored CV' })).toBeVisible();
  expect(made).toEqual({ candidate_id: 7, job_posting_id: 55, type: 'tailored_cv' });
  await Promise.all([job.close(), popup.close()]);
});

/* ---- 0.4.0: applying, made easy ------------------------------------------ */
const ANSWERS = [200, {
  answers: [
    { key: 'name', label: 'Full name', value: 'Amy Jones', group: 'about' },
    { key: 'phone', label: 'Phone', value: '07700 900123', group: 'about' },
    { key: 'linkedin', label: 'LinkedIn', value: 'https://www.linkedin.com/in/amy', group: 'links' },
  ],
  missing: ['GitHub', 'Security clearance'],
  profile_path: '/candidate',
}];
const PRO_ME2 = [200, { user: USER, role: "seeker", cv_count: 2, my_cv: { id: 9, version_number: 3 }, job_insight: true, candidate_id: 7, documents: true }];
const INSIGHT2 = [200, { scoreable: true, score: 78, verdict: 'A strong fit.', strongest: [], weakest: [], gaps: [], transferable: [], next_step: null, history: null }];

test('seen before, Pro: the journey, advert check, screening answer, form helper and follow-up', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': PRO_ME2,
    'POST /extension/capture': [200, { ...CAPTURED, existing: [{ id: 55, title: 'Delivery Manager' }] }],
    'GET /extension/seeker/jobs/55': [200, JOB().data],
    'GET /extension/seeker/jobs/55/insight': INSIGHT2,
    'GET /extension/seeker/jobs/55/application': TRACK('applied', ['interviewing', 'rejected', 'withdrawn'], day(-3), { checked_on: day(-4), follow_up_on: day(4) }),
    'POST /extension/seeker/jobs/55/follow-up': (req) => TRACK('applied', ['interviewing', 'rejected', 'withdrawn'], day(-3), { checked_on: day(-4), follow_up_on: day(-3 + JSON.parse(req.postData()).days) }),
    'POST /extension/seeker/jobs/55/advert-check': [200, {
      closing: { date: day(2), days_left: 2, passed: false }, reminder: false, pay_shown: true, clear: false,
      signs: [{ level: 'bad', title: 'Asks you to pay', why: 'A genuine employer does not charge you.', found: '...a small training fee of £50...' }, { level: 'warn', title: 'Contact by WhatsApp or Telegram', why: 'Worth questioning.', found: null }],
    }],
    'POST /extension/seeker/jobs/55/screening-answer': [200, { answer: 'At Acme I led agile delivery for two payments teams.', needs: null, sources: 2, left_today: 24 }],
    'GET /extension/seeker/form-answers': ANSWERS,
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();

  await expect(popup.getByText('SEEN BEFORE', { exact: true })).toBeVisible();
  await expect(popup.locator('.apply-head .seen-tag')).toContainText('SEEN');
  await expect(popup.locator('.jstep.done')).toHaveCount(2);
  await expect(popup.locator('.jstep').nth(2).locator('.jlabel')).toHaveText('Follow up');

  // Advert check.
  await expect(popup.getByRole('heading', { name: 'Advert check' })).toBeVisible();
  await expect(popup.getByText('Closes in 2 days')).toBeVisible();
  await expect(popup.locator('.sign.bad')).toContainText('Asks you to pay');
  await expect(popup.locator('.sign.warn')).toContainText('WhatsApp');

  // Follow-up: 2 weeks.
  await expect(popup.getByRole('button', { name: '1 week' })).toHaveAttribute('aria-pressed', 'true');
  await popup.getByRole('button', { name: '2 weeks' }).click();
  await expect(popup.getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true');
  expect(x.calls.find((c) => c.path === '/extension/seeker/jobs/55/follow-up').body).toEqual({ days: 14 });

  // Screening answer.
  await popup.getByLabel('The screening question').fill('Tell us about a time you led a team through change.');
  await popup.getByRole('button', { name: 'Write my answer' }).click();
  await expect(popup.getByText('At Acme I led agile delivery for two payments teams.')).toBeVisible();
  await expect(popup.getByText(/From 2 things on your record/)).toBeVisible();

  if (process.env.SHOTS) await popup.locator('.apply-card').screenshot({ path: `${process.env.SHOTS}/seeker-apply-card.png` }), await popup.locator('.advert-card').screenshot({ path: `${process.env.SHOTS}/seeker-advert-card.png` });
  // Form helper inside step 1.
  await popup.getByRole('button', { name: 'Show my answers' }).click();
  await expect(popup.locator('.answers li')).toHaveCount(3);
  await expect(popup.getByText('Not in your profile yet: GitHub, Security clearance.')).toBeVisible();
  await popup.locator('.answers li').nth(1).getByRole('button').click();
  await expect(popup.locator('.answers li').nth(1).getByRole('button')).toHaveText('✓ Copied');
  if (process.env.SHOTS) await popup.setViewportSize({ width: 380, height: 2200 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-apply.png`, fullPage: true });
  await popup.getByRole('button', { name: 'Add them once in your profile →' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/candidate']);
  await Promise.all([job.close(), popup.close()]);
});

test('Job Seeker: screening answers locked with the Pro pitch, no advert check; the form helper from home', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': ME(), 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(), 'GET /extension/seeker/form-answers': ANSWERS,
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Open the form helper' }).click();
  await expect(popup.getByRole('heading', { name: 'Your form helper' })).toBeVisible();
  await expect(popup.getByText('07700 900123')).toBeVisible();
  await popup.getByRole('button', { name: 'Back' }).click();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.getByRole('heading', { name: 'Apply for this job' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'See Job Seeker Pro' })).toBeVisible();
  await expect(popup.getByRole('heading', { name: 'Advert check' })).toHaveCount(0);
  expect(x.calls.some((c) => c.path.endsWith('/advert-check'))).toBe(false);
  await expect(popup.getByText(/Screening questions answered from your own CV/)).toBeVisible(); // in the Pro pitch
  await Promise.all([job.close(), popup.close()]);
});

test('the job stays put until it is marked applied (0.4.1)', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': ME(), 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55': [200, JOB().data],
    'GET /extension/seeker/jobs/55/application': TRACK(),
    'POST /extension/seeker/jobs/55/status': TRACK('applied', ['interviewing', 'rejected', 'withdrawn'], day(0)),
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.getByRole('heading', { name: 'Apply for this job' })).toBeVisible();
  await popup.close();

  // Opened again (the panel was closed): straight back to the same job.
  const again = await x.popup();
  await expect(again.getByText(/Kept here while you apply/)).toBeVisible();
  await expect(again.getByRole('heading', { name: 'Apply for this job' })).toBeVisible();
  await again.getByRole('button', { name: "I've applied" }).click();
  await expect(again.getByText(/Marked as applied/)).toBeVisible();
  await again.close();

  // Applied: let go - the next open is the home screen.
  const third = await x.popup();
  await expect(third.getByRole('heading', { name: 'Check this job' })).toBeVisible();
  await Promise.all([job.close(), third.close()]);
});

/* ---- 0.5.0: after applying ------------------------------------------------ */
test('cover letter: written here, then downloaded; one already made downloads straight away', async () => {
  let made = null;
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': DOC_ME, 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(),
    'POST /extension/seeker/documents/generate': (req) => ((made = req.postDataJSON()), [202, { data: { id: 901, status: 'pending' } }]),
    'GET /extension/seeker/documents/901': [200, { data: { id: 901, status: 'evidence_checked' } }],
    'GET /extension/seeker/documents/901/download': [200, { file: 'docx' }],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.getByRole('heading', { name: 'Cover letter' })).toBeVisible();
  await popup.getByRole('button', { name: 'Write my cover letter' }).click();
  await expect(popup.getByText(/Writing your cover letter/)).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Download my cover letter' })).toBeVisible({ timeout: 10000 });
  expect(made).toEqual({ candidate_id: 7, job_posting_id: 55, type: 'cover_letter' });
  expect(x.calls.some((c) => c.path === '/extension/seeker/documents/901/download')).toBe(true);
  await Promise.all([job.close(), popup.close()]);
});

test('interview prep appears once there is an interview: questions, then answers from the CV', async () => {
  await x.connectAs(USER, 'seeker');
  const Q = (asked) => ({ answers: [
    { id: 1, question: 'Tell us about leading agile delivery.', answer: asked ? 'At Acme I led two payments teams.' : null, needs: null, asked },
    { id: 2, question: 'How do you handle stakeholders?', answer: null, needs: asked ? 'Add a STAR story about stakeholders.' : null, asked },
  ] });
  await x.mockApi({
    'GET /extension/me': ME(), 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK('applied', ['interviewing', 'rejected', 'withdrawn'], day(-5)),
    'POST /extension/seeker/jobs/55/status': TRACK('interviewing', ['offer', 'rejected', 'withdrawn'], day(-5)),
    'POST /extension/seeker/jobs/55/interview-prep/questions': [200, Q(false)],
    'POST /extension/seeker/jobs/55/interview-prep/answers': [200, Q(true)],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await expect(popup.getByText('Prepare for the interview')).toHaveCount(0);
  await popup.getByRole('button', { name: 'Got an interview' }).click();
  await popup.getByRole('button', { name: 'Show the likely questions' }).click();
  await expect(popup.getByText('Tell us about leading agile delivery.')).toBeVisible();
  await popup.getByRole('button', { name: 'Write my answers from my CV' }).click();
  await expect(popup.getByText('At Acme I led two payments teams.')).toBeVisible();
  await expect(popup.getByText('Add a STAR story about stakeholders.')).toBeVisible();
  if (process.env.SHOTS) await popup.locator('.prep').screenshot({ path: `${process.env.SHOTS}/seeker-prep.png` });
  await popup.getByRole('button', { name: 'Open the Interview Centre' }).click();
  expect(await popup.evaluate(() => window.__opened)).toEqual(['https://app.ats-engine.com/interviews?job=55']);
  await Promise.all([job.close(), popup.close()]);
});

test('company snapshot (Pro): asked for, researched, shown as unverified', async () => {
  await x.connectAs(USER, 'seeker');
  let state = 'not_requested';
  await x.mockApi({
    'GET /extension/me': PRO_ME2, 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(), 'GET /extension/seeker/jobs/55/insight': INSIGHT2,
    'GET /extension/seeker/jobs/55/company': () => [200, state === 'ready'
      ? { status: 'ready', company: 'Acme Bank', overview: 'A UK bank. Publicly available detail is limited.', culture: ['Regulated, process-led'], recent: [], questions: ['How do teams plan releases?'], verified: false }
      : { status: state }],
    'POST /extension/seeker/jobs/55/company': () => ((state = 'ready'), [202, { status: 'pending', company: 'Acme Bank' }]),
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  const card = popup.locator('.company-card');
  await expect(card.getByRole('heading', { name: 'About Acme Bank' })).toBeVisible();
  await card.getByRole('button', { name: 'Get the company snapshot' }).click();
  await expect(card.getByText('A UK bank. Publicly available detail is limited.')).toBeVisible({ timeout: 10000 });
  await expect(card.getByText('How do teams plan releases?')).toBeVisible();
  await expect(card.getByText(/not verified/)).toBeVisible();
  if (process.env.SHOTS) await card.screenshot({ path: `${process.env.SHOTS}/seeker-company.png` }), await popup.locator('.apply-card').screenshot({ path: `${process.env.SHOTS}/seeker-apply4.png` });
  await Promise.all([job.close(), popup.close()]);
});

test('a page the side panel may not read yet: one Allow, then it reads it (0.5.1)', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({ 'GET /extension/me': ME(), 'POST /extension/capture': [200, CAPTURED] });
  const { job, popup } = await x.popupOnJob();
  await popup.evaluate(() => {
    const real = chrome.scripting.executeScript.bind(chrome.scripting);
    window.__allowed = false;
    chrome.scripting.executeScript = (o) => (window.__allowed ? real(o) : Promise.reject(new Error('Cannot access contents of the page')));
    chrome.permissions.request = async (p) => { window.__asked = p; window.__allowed = true; return true; };
  });
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await expect(popup.getByRole('heading', { name: 'One click to read job pages' })).toBeVisible();
  await popup.getByRole('button', { name: 'Allow ATS Engine to read job pages' }).click();
  await expect(popup.getByRole('heading', { name: 'Is this the job?' })).toBeVisible();
  expect(await popup.evaluate(() => window.__asked)).toEqual({ origins: ['https://*/*', 'http://*/*'] });
  await Promise.all([job.close(), popup.close()]);
});

test('common answers saved to the account; equality answers kept in the browser only (0.5.2)', async () => {
  await x.connectAs(USER, 'seeker');
  let saved = null;
  const COMMON = (v = {}) => [
    { key: 'right_to_work', label: 'Right to work in the UK', kind: 'yesno', value: v.right_to_work || null },
    { key: 'salary', label: 'Salary expectation', kind: 'text', value: v.salary || null },
    { key: 'relocate', label: 'Willing to relocate', kind: 'choice', value: v.relocate || null },
  ];
  await x.mockApi({
    'GET /extension/me': ME(),
    'GET /extension/seeker/form-answers': () => [200, { answers: [{ key: 'name', label: 'Full name', value: 'Amy Jones', group: 'about' },
      ...(saved ? [{ key: 'right_to_work', label: 'Right to work in the UK', value: saved.right_to_work, group: 'questions' }, { key: 'salary', label: 'Salary expectation', value: saved.salary, group: 'questions' }] : [])],
      common: COMMON(saved || {}), missing: [], profile_path: '/candidate' }],
    'PUT /extension/seeker/form-answers': (req) => { saved = JSON.parse(req.postData()).answers; return [200, { answers: [], common: COMMON(saved), missing: [] }]; },
  });
  const popup = await x.popup();
  await popup.getByRole('button', { name: 'Open the form helper' }).click();
  await popup.locator('.form-group', { hasText: 'Common questions' }).getByRole('button', { name: 'Add my answers' }).click();
  await popup.getByLabel('Right to work in the UK').selectOption('Yes');
  await popup.getByLabel('Salary expectation').fill('£60,000 - £65,000');
  await popup.getByRole('button', { name: 'Save my answers' }).click();
  await expect(popup.getByText('£60,000 - £65,000')).toBeVisible();
  expect(saved).toEqual({ right_to_work: 'Yes', salary: '£60,000 - £65,000', relocate: '' });

  await popup.locator('.eq-group').getByRole('button', { name: 'Add my answers' }).click();
  await popup.getByLabel('Gender', { exact: true }).selectOption('Woman');
  await popup.getByLabel('Disability or long-term condition').selectOption('Prefer not to say');
  await popup.getByRole('button', { name: 'Save on this computer' }).click();
  await expect(popup.locator('.eq-group .answers li')).toHaveCount(2);
  const stored = await x.sw.evaluate(() => chrome.storage.local.get('atsEngineEqualityAnswers'));
  expect(stored.atsEngineEqualityAnswers).toEqual({ gender: 'Woman', disability: 'Prefer not to say' });
  expect(JSON.stringify(x.calls)).not.toContain('Woman'); // never sent to ATS Engine
  if (process.env.SHOTS) await popup.setViewportSize({ width: 400, height: 1200 }), await popup.screenshot({ path: `${process.env.SHOTS}/seeker-form-eq.png`, fullPage: true });
  await popup.locator('.eq-group').getByRole('button', { name: 'Change my answers' }).click();
  await popup.getByRole('button', { name: 'Clear them all' }).click();
  await expect(popup.locator('.eq-group .answers')).toHaveCount(0);
  await popup.close();
});

test('a motivation question: the answer, and a nudge to make it yours (0.5.3)', async () => {
  await x.connectAs(USER, 'seeker');
  await x.mockApi({
    'GET /extension/me': PRO_ME2, 'POST /extension/capture': [200, CAPTURED], 'POST /extension/seeker/jobs': [201, JOB()],
    'GET /extension/seeker/jobs/55/application': TRACK(), 'GET /extension/seeker/jobs/55/insight': INSIGHT2,
    'POST /extension/seeker/jobs/55/screening-answer': [200, { answer: 'The advert describes leading agile delivery for payments teams, which is what I did at Northgate.', sources: 1, kind: 'motivation', personal_prompt: 'Is there something about banking that matters to you personally?', left_today: 24 }],
  });
  const { job, popup } = await x.popupOnJob();
  await popup.getByRole('button', { name: 'Check this job' }).click();
  await popup.getByRole('button', { name: 'Check my match' }).click();
  await popup.getByLabel('The screening question').fill('Tell us a little about what attracts you to Acme Bank:');
  await popup.getByRole('button', { name: 'Write my answer' }).click();
  await expect(popup.getByText(/what I did at Northgate/)).toBeVisible();
  await expect(popup.locator('.screen-tip')).toContainText('Make it yours: Is there something about banking that matters to you personally?');
  await Promise.all([job.close(), popup.close()]);
});
