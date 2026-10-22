/*
 * ATS Engine - Seekers - the popup (Phase 1, 21 Oct 2026).
 *
 *   Connect -> Check this job -> review -> Check my match
 *           -> your match, requirements, next step
 *           -> View full analysis / Tailor my CV / I've applied / Tracker
 *
 * Check my match is ATS Engine's own Add a job (Job Analysis): the job is
 * saved to the candidate's account, analysed, scored against their CVs
 * and put in their Application Tracker - exactly as if they had pasted it
 * into the app. This popup shows the result; it computes nothing. Every
 * word from the page or the API goes in as text, never HTML.
 */
import { CONFIG } from './core/config.js';
import { createApi } from './core/api.js';
import { getConnection, clearConnection, connectUrl } from './core/connection.js';
import { readPage } from './core/page-reader.js';
import { cleanFields, missingRequired } from './core/fields.js';
import { links } from './core/links.js';
import { h, notice, fill, paged } from './core/dom.js';
import { reviewForm } from './core/review-form.js';
import { summarise, insightSummary, INSIGHT_PITCH, EVIDENCE } from './core/match.js';
import { STATUS, MOVE, statusLabel } from './core/tracker.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const foot = document.getElementById('foot');
const to = links(CONFIG.appBase);
let cvCount = null;
let myCv = null; // the CV Creator's one active CV, if built
let jobInsight = false; // Job Seeker Pro and its trial (E3) - the server checks again

const api = createApi({
  baseUrl: CONFIG.apiBase,
  getToken: async () => (await getConnection())?.token || '',
  onUnauthorised: () => clearConnection(),
});

const show = (...nodes) => fill(app, ...nodes);
const open = (url) => chrome.tabs.create({ url });
const busy = (text) => show(h('div', { class: 'card' }, h('p', { class: 'muted', text })));

function showWho(connection) {
  const u = connection?.user || {};
  who.replaceChildren(h('strong', { text: u.name || '' }), document.createTextNode('Job seeker'));
  who.hidden = false;
  foot.hidden = false;
}

// ---- screens ---------------------------------------------------------------
function connectScreen(message) {
  // Before sign-in the header says which login this is (Dennis, 21 Oct 2026).
  who.replaceChildren(h('strong', { class: 'login-label', text: 'Seeker Login' }));
  who.hidden = false;
  foot.hidden = true;
  show(
    message ? notice('warn', message) : null,
    h(
      'div',
      { class: 'card' },
      h('h1', { text: 'Stop applying blindly' }),
      h('p', { class: 'muted', text: 'See a job? Check it with ATS Engine. See how well your CV matches, what is missing, and what to do before you apply.' }),
      h('button', { class: 'btn', type: 'button', text: 'Connect to ATS Engine', onclick: () => open(connectUrl(CONFIG.appBase, chrome.runtime.id)) }),
      h('p', { class: 'muted', style: 'margin-top:10px', text: 'Opens ATS Engine in a new tab. Sign in there if asked, press Connect, then come back here.' }),
      h('p', { class: 'for', text: 'For job seeker accounts. Recruiting? Use ATS Engine - Recruiters instead.' }),
    ),
  );
}

function homeScreen(message) {
  show(
    message ? notice('bad', message) : null,
    cvCount === 0
      ? h(
          'div',
          { class: 'card' },
          h('h1', { text: 'Add your CV first' }),
          h('p', { class: 'muted', text: 'ATS Engine checks every job against your CV. Upload it once in your CV Library.' }),
          h('button', { class: 'btn', type: 'button', text: 'Upload your CV', onclick: () => open(to.cvLibrary()) }),
        )
      : null,
    h(
      'div',
      { class: 'card' },
      h('h1', { text: 'Check this job' }),
      h('p', { class: 'muted', text: 'Reads the job advert on this page so you can check it before ATS Engine matches it to your CV. Tip: highlight the job description first on sites that hide it.' }),
      h('button', { class: 'btn', type: 'button', text: 'Check this job', onclick: capture }),
      myCv
        ? h('p', { class: 'for', text: `Your Master CV: version ${myCv.version_number}${myCv.updated_at ? `, saved ${myCv.updated_at.slice(0, 10)}` : ''}.` })
        : null,
    ),
  );
}

async function capture() {
  busy('Reading the page…');
  let page;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Open a job advert in this tab first.');
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    page = result?.result;
    if (!page?.html) throw new Error('This page could not be read.');
  } catch (err) {
    return homeScreen(err.message || 'This page could not be read.');
  }

  busy('ATS Engine is reading the job…');
  try {
    reviewScreen(await api.capture(page), page);
  } catch (err) {
    handleError(err);
  }
}

function reviewScreen(res, page) {
  const values = { ...res.fields };
  if (!res.is_job_page && page.selection && !values.description) values.description = page.selection;
  const form = reviewForm(values);
  const status = h('div');
  const notFound = (res.not_found || []).length;
  const before = (res.existing || [])[0];

  const check = async () => {
    const v = form.read();
    const missing = missingRequired(v);
    if (missing.length) return status.replaceChildren(notice('bad', `Add ${missing.join(', ')} first.`));
    status.replaceChildren(notice('ok', 'Matching this job to your CV…'));
    try {
      const saved = await api.checkMatch(cleanFields(v));
      resultScreen(saved?.data || saved);
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      if (err.status === 402) return planScreen(err.message);
      status.replaceChildren(notice('bad', err.message));
    }
  };

  show(
    !res.is_job_page ? notice('warn', 'This does not look like a job advert. You can still fill it in by hand.') : null,
    ...(res.warnings || []).map((w) => notice('warn', w)),
    before ? notice('ok', `You checked this job before (${before.title || 'Untitled'}). Checking again updates it - nothing is duplicated.`) : null,
    h(
      'div',
      { class: 'card' },
      h('h1', { text: 'Is this the job?' }),
      notFound ? h('p', { class: 'muted' }, h('span', { class: 'pill warn', text: `${notFound} not on the page` }), ' Fill in anything you know.') : null,
      form.nodes,
      h('p', { class: 'source', style: 'margin-top:10px', text: `From ${res.fields?.source_site || ''}` }),
      status,
      h('button', { class: 'btn green', type: 'button', text: 'Check my match', onclick: check }),
    ),
  );
}

function resultScreen(job) {
  const fit = job?.candidate_fit || null;
  const s = summarise(fit, { cvCount, application: job?.application });
  const id = job?.id;

  const reqList = s.requirements.length
    ? h(
        'ul',
        { class: 'reqs' },
        s.requirements.slice(0, 8).map((r) => {
          const e = EVIDENCE[r.band];
          return h('li', { title: e.note }, h('span', { text: r.skill }), h('span', { class: `band ${e.tone}`, text: `${e.symbol} ${e.label}` }));
        }),
      )
    : null;

  const tailorFirst = s.next.kind === 'tailor';
  const canTailor = fit?.meets_minimum || fit?.tailoring_can_meet_minimum;
  const tracker = id ? h('div', { class: 'card' }, h('p', { class: 'muted', text: 'Checking your Application Tracker…' })) : null;
  if (tracker) loadTracker(tracker, id);
  const insight = id ? (jobInsight ? h('div', { class: 'card pro-card' }, h('p', { class: 'muted', text: 'Job Insight is reading this job against your CV…' })) : proTeaser()) : null;
  if (id && jobInsight) loadInsight(insight, id);

  show(
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'score score--fit' },
        // The fit, big (Dennis, 22 Oct 2026): a ring filled to the score,
        // the number in the middle and the word "fit" under it.
        s.score === null
          ? h('div', { class: 'num none', text: 'No score' })
          : h('div', { class: `num fit-ring ${s.tone}`, style: `--p:${Math.max(0, Math.min(100, s.score))}`, role: 'img', 'aria-label': `${s.score}% fit` },
              h('span', { class: 'fit-num', text: `${s.score}%` }), h('span', { class: 'fit-word', text: 'fit' })),
        h('div', {}, h('h1', { text: s.headline }), h('p', { class: 'muted', style: 'margin:0', text: `${job?.title || ''}${job?.company ? ` · ${job.company}` : ''}` })),
      ),
      s.requirements.length
        ? h(
            'div',
            { class: 'counts' },
            h('span', { class: 'pill ok', text: `${s.met} requirement${s.met === 1 ? '' : 's'} evidenced` }),
            s.gaps ? h('span', { class: 'pill warn', text: `${s.gaps} to strengthen` }) : null,
          )
        : null,
      s.detail ? h('p', { style: 'margin-top:10px', text: s.detail }) : null,
      s.next.text ? h('div', { class: 'next', text: s.next.text }) : null,
      reqList ? h('h2', { text: 'What the job asks for' }) : null,
      reqList,
      s.requirements.length > 8 ? h('p', { class: 'muted', style: 'margin-top:6px', text: `and ${s.requirements.length - 8} more in the full analysis.` }) : null,
      s.cv ? h('p', { class: 'muted', style: 'margin-top:10px', text: `Matched against ${s.cv}` }) : null,
    ),
    insight,
    tracker,
    h(
      'div',
      { class: 'card' },
      s.next.kind === 'upload' ? h('button', { class: 'btn', type: 'button', text: 'Upload your CV', onclick: () => open(to.cvLibrary()) }) : null,
      id && (tailorFirst || canTailor) ? tailorBlock(id, tailorFirst) : null,
      id ? h('button', { class: `btn${tailorFirst ? ' secondary' : ''}`, type: 'button', text: 'View full analysis', onclick: () => open(to.jobAnalysis(id)) }) : null,
      h('button', { class: 'btn secondary', type: 'button', text: 'Check another job', onclick: start }),
    ),
  );
}

/*
 * Tailor my CV (Phase 2): the CV Creator's own Tailor to job, opened on
 * this job. The candidate reviews every suggested change there, and saving
 * makes the tailored version their one active CV - the old one stays in
 * the version history. Nothing is changed from the popup.
 */
function tailorBlock(jobId, primary) {
  if (!myCv) {
    return h(
      'div',
      { style: 'margin-bottom:8px' },
      h('button', { class: `btn${primary ? ' green' : ''}`, type: 'button', text: 'Build your Master CV to tailor it', onclick: () => open(to.myCv()) }),
      h('p', { class: 'for', text: 'Tailoring works on your Master CV in CV Creator. Build it once from your profile or an uploaded CV.' }),
    );
  }
  return h(
    'div',
    { style: 'margin-bottom:8px' },
    h('button', { class: `btn${primary ? ' green' : ''}`, type: 'button', text: 'Tailor my CV for this job', onclick: () => open(to.tailorMyCv(jobId)) }),
    h('p', { class: 'for', text: `Opens CV Creator on this job. You check every change; saving makes it your active CV (version ${myCv.version_number + 1}) and keeps the old one in your history.` }),
  );
}

/* ---- Job Insight (E3): Job Seeker Pro and its trial ------------------------ */
const PER_PAGE = 3;

async function loadInsight(card, jobId) {
  try {
    renderInsight(card, await api.jobInsight(jobId));
  } catch (err) {
    if (err.status === 401) return connectScreen(err.message);
    if (err.status === 402 && err.code === 'plan_feature_unavailable') return card.replaceWith(proTeaser(err.message));
    card.replaceChildren(h('h2', { text: 'Job Insight' }), notice('bad', err.message));
  }
}

function renderInsight(card, res) {
  const s = insightSummary(res);
  const go = (path) => () => open(to.route(path));
  const section = (title, ...nodes) => [h('h2', { style: 'margin-top:12px', text: title }), ...nodes];
  const rows = (list, tone) => h('ul', { class: 'reqs' }, list.map((c) => h('li', {}, h('span', { text: c.label }), h('span', { class: `band ${tone}`, text: c.detail }))));
  fill(
    card,
    h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: 'Job Insight' })),
    s.verdict ? h('p', { style: 'margin-top:8px', text: s.verdict }) : null,
    s.step
      ? h('div', { class: 'cover warn next-step' }, h('strong', { text: `Next: ${s.step.title}` }), h('span', { text: s.step.reason }),
          s.step.destination ? h('button', { class: 'btn-mini', type: 'button', text: `${s.step.action?.label || 'Open'} →`, onclick: go(s.step.destination) }) : null)
      : null,
    ...(s.strongest.length ? section('Where you are strong', rows(s.strongest, 'ok')) : []),
    ...(s.weakest.length ? section('Where you lose marks', rows(s.weakest, 'warn')) : []),
    ...(s.gaps.length
      ? section(`Fix these first (${s.gaps.length})`, paged(s.gaps, PER_PAGE, (page) => h('ul', { class: 'pro-list' }, page.map((g) => h('li', {},
          h('div', { class: 'pro-row' }, h('span', { class: `pill ${g.ev.tone}`, text: g.ev.label }), h('strong', { text: g.skill })),
          h('span', { class: 'muted', text: g.fix }),
        ))), 'Gaps to fix'))
      : []),
    ...(s.transferable.length
      ? section("You have this - this CV doesn't show it", h('div', { class: 'chips' }, s.transferable.map((t) => h('span', { class: 'chip', text: t }))),
          h('p', { class: 'muted', text: 'Another of your CVs shows these better. Bringing them into the CV you send is the quickest gain.' }))
      : []),
    s.history ? h('p', { class: 'history', text: s.history }) : null,
  );
}

/* Job Seeker: what Job Seeker Pro would add here - sold, not just mentioned. */
function proTeaser(message) {
  return h(
    'div',
    { class: 'card pro-card' },
    h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: 'Know if this job is worth your evening' })),
    h('p', { style: 'margin-top:8px', text: message || 'Job Insight comes with Job Seeker Pro - and it is free in the 14-day trial. On every job you look at:' }),
    h('ul', { class: 'tips pro-pitch' }, INSIGHT_PITCH.map((t) => h('li', { text: t }))),
    h('button', { class: 'btn gold', type: 'button', text: 'Upgrade to Job Seeker Pro', onclick: () => open(to.subscription()) }),
    h('p', { class: 'for', text: 'Everything you have now stays exactly as it is.' }),
  );
}

/* Where this job is in the Application Tracker, and the moves ATS Engine allows from there. */
async function loadTracker(card, jobId) {
  const render = (a, message) => {
    const st = STATUS[a.status] || { tone: 'warn' };
    fill(
      card,
      h('h2', { text: 'Application Tracker' }),
      h('p', {}, 'This job is ', h('span', { class: `pill ${st.tone}`, text: statusLabel(a.status) }), a.applied_on ? ` · applied ${a.applied_on}` : ''),
      message ? notice('ok', message) : null,
      ...(a.next || []).map((n) =>
        h('button', {
          class: `btn ${n === 'applied' ? '' : 'secondary'}`.trim(),
          type: 'button',
          text: MOVE[n] || n,
          onclick: async () => {
            try {
              const moved = await api.setStatus(jobId, n);
              render(moved, n === 'applied' ? `Marked as applied (${moved.applied_on}).` : `Moved to ${statusLabel(moved.status)}.`);
            } catch (err) {
              if (err.status === 401) return connectScreen(err.message);
              if (err.status === 402) return planScreen(err.message);
              render(err.body?.application || a, null);
              card.append(notice('bad', err.message));
            }
          },
        }),
      ),
      h('button', { class: 'link', type: 'button', style: 'margin-top:8px', text: 'Open Application Tracker', onclick: () => open(to.applications()) }),
    );
  };
  try {
    render(await api.seekerApplication(jobId));
  } catch (err) {
    if (err.status === 401) return connectScreen(err.message);
    if (err.status === 402) return planScreen(err.message);
    card.replaceChildren(
      h('h2', { text: 'Application Tracker' }),
      h('p', { class: 'muted', text: err.status === 404 ? 'This job is not in your Application Tracker yet.' : err.message }),
      h('button', { class: 'link', type: 'button', text: 'Open Application Tracker', onclick: () => open(to.applications()) }),
    );
  }
}

/* Free accounts: the extension is part of the paid plans and the trial. */
function planScreen(message) {
  show(
    h(
      'div',
      { class: 'card' },
      h('h1', { text: 'Part of the paid plans' }),
      h('p', { text: message || 'The ATS Engine browser extension comes with Job Seeker and Job Seeker Pro, and with the 14-day free trial.' }),
      h('button', { class: 'btn', type: 'button', text: 'See plans in ATS Engine', onclick: () => open(to.subscription()) }),
    ),
  );
}

function handleError(err) {
  if (err.status === 402) return planScreen(err.message);
  if (err.status === 401) return connectScreen(err.message);
  if (err.status === 402) return planScreen(err.message);
  homeScreen(err.message);
}

// ---- start -----------------------------------------------------------------
async function start() {
  const connection = await getConnection();
  if (!connection?.token) return connectScreen();
  showWho(connection);
  homeScreen();
  try {
    const me = await api.me();
    if (me.role && me.role !== 'seeker') {
      return connectScreen('You are signed in with a recruiter account. This is the job seeker extension - use ATS Engine - Recruiters instead, and you can remove this one.');
    }
    cvCount = typeof me.cv_count === 'number' ? me.cv_count : null;
    myCv = me.my_cv || null;
    jobInsight = me.job_insight === true;
    showWho({ ...connection, user: me.user });
    homeScreen();
  } catch (err) {
    if (err.status === 401) connectScreen(err.message);
    else if (err.status === 402) planScreen(err.message);
  }
}

document.getElementById('open-app').addEventListener('click', () => open(CONFIG.appBase));
document.getElementById('disconnect').addEventListener('click', async () => {
  try {
    await api.disconnect();
  } catch {
    // disconnected locally either way
  }
  await clearConnection();
  connectScreen('Disconnected from ATS Engine.');
});

start();
