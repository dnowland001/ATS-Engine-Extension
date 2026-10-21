/*
 * ATS Engine for Job Seekers - the popup (Phase 1, 21 Oct 2026).
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
import { h, notice, fill } from './core/dom.js';
import { reviewForm } from './core/review-form.js';
import { summarise, EVIDENCE } from './core/match.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const foot = document.getElementById('foot');
const to = links(CONFIG.appBase);
let cvCount = null;

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
  who.hidden = true;
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
      h('p', { class: 'for', text: 'For job seeker accounts. Recruiting? Use ATS Engine for Recruiters instead.' }),
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
  const status = h('div');

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

  const applied = async () => {
    status.replaceChildren(notice('ok', 'Updating your Application Tracker…'));
    try {
      const a = await api.markApplied(id);
      status.replaceChildren(notice('ok', a.already ? 'Already marked as applied in your Application Tracker.' : `Marked as applied today (${a.applied_on}) in your Application Tracker.`));
      appliedBtn.remove();
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      status.replaceChildren(notice('bad', err.message));
    }
  };
  const appliedBtn = h('button', { class: 'btn secondary', type: 'button', text: "I've applied", onclick: applied });
  const tailorFirst = s.next.kind === 'tailor';

  show(
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'score' },
        h('div', { class: `num ${s.score === null ? 'none' : s.tone}`, text: s.score === null ? 'No score' : `${s.score}%` }),
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
    h(
      'div',
      { class: 'card' },
      status,
      s.next.kind === 'upload' ? h('button', { class: 'btn', type: 'button', text: 'Upload your CV', onclick: () => open(to.cvLibrary()) }) : null,
      id
        ? h('button', { class: `btn${tailorFirst ? ' green' : ''}`, type: 'button', text: tailorFirst ? 'Tailor my CV in ATS Engine' : 'View full analysis', onclick: () => open(to.jobAnalysis(id)) })
        : null,
      id && !tailorFirst && (fit?.meets_minimum || fit?.tailoring_can_meet_minimum)
        ? h('button', { class: 'btn secondary', type: 'button', text: 'Tailor my CV', onclick: () => open(to.jobAnalysis(id)) })
        : null,
      id && !s.applied ? appliedBtn : null,
      h('button', { class: 'btn secondary', type: 'button', text: 'Application Tracker', onclick: () => open(to.applications()) }),
      h('button', { class: 'btn secondary', type: 'button', text: 'Check another job', onclick: start }),
    ),
  );
}

function handleError(err) {
  if (err.status === 401) return connectScreen(err.message);
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
      return connectScreen('You are signed in with a recruiter account. This is the job seeker extension - use ATS Engine for Recruiters instead, and you can remove this one.');
    }
    cvCount = typeof me.cv_count === 'number' ? me.cv_count : null;
    showWho({ ...connection, user: me.user });
    homeScreen();
  } catch (err) {
    if (err.status === 401) connectScreen(err.message);
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
