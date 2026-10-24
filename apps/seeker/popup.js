/*
 * ATS Engine - Seekers - the popup (Phase 1, 21 Oct 2026).
 *
 *   Connect -> Check this job -> review -> Check my match
 *           -> your match, requirements, next step
 *           -> View full analysis / Tailor my CV / I've applied / Tracker
 *
 * 0.4.0 (23 Oct 2026), applying made easy: "you've seen this before" with
 * the application's journey; Apply for this job in three steps - the form
 * helper (copy your own details), screening answers from your own CV
 * (Pro), I've applied with a follow-up reminder; and the advert check
 * (Pro): the closing date and the warning signs.
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
import { summarise, insightSummary, fullFit, INSIGHT_PITCH, EVIDENCE, DOC_DONE } from './core/match.js';
import { STATUS, MOVE, statusLabel } from './core/tracker.js';
import { dayLabel, relative, seenBefore, journey, FOLLOW_UP, followUpDays, closingBadge, SIGN, APPLY_PRO } from './core/apply.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const foot = document.getElementById('foot');
const to = links(CONFIG.appBase);
let cvCount = null;
let myCv = null; // the CV Creator's one active CV, if built
let jobInsight = false; // Job Seeker Pro and its trial (E3) - the server checks again
let candidateId = null; // their own, for making a tailored CV
let canTailorCv = false; // their plan makes tailored CVs

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
    h(
      'div',
      { class: 'card tool-card' },
      h('div', { class: 'tool-head' }, h('span', { class: 'tool-icon', 'aria-hidden': 'true', text: '⧉' }), h('div', {},
        h('h2', { text: 'Filling in an application form?' }),
        h('p', { class: 'muted', style: 'margin:0', text: 'Your name, phone, address and links, one click to copy each.' }))),
      h('button', { class: 'btn secondary', type: 'button', style: 'margin-top:10px', text: 'Open the form helper', onclick: () => formHelperScreen() }),
    ),
  );
}

/* ---- The form helper (0.4.0): their own profile's answers, ready to copy ---- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = h('textarea', { style: 'position:fixed;opacity:0' });
    t.value = text;
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

function copyButton(text, label = 'Copy') {
  const btn = h('button', { class: 'copy-btn', type: 'button', text: label, 'aria-label': `${label}: ${text.slice(0, 40)}` });
  btn.addEventListener('click', async () => {
    const ok = await copyText(text);
    btn.textContent = ok ? '✓ Copied' : 'Press Ctrl+C';
    btn.classList.toggle('done', ok);
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove('done');
    }, 1600);
  });
  return btn;
}

const GROUPS = [['about', 'About you'], ['work', 'Work'], ['links', 'Links']];

async function formPanel(box) {
  fill(box, h('p', { class: 'muted', text: 'Getting your details…' }));
  let res;
  try {
    res = await api.formAnswers();
  } catch (err) {
    if (err.status === 401) return connectScreen(err.message);
    if (err.status === 402) return planScreen(err.message);
    return fill(box, notice('bad', err.message));
  }
  const answers = res.answers || [];
  fill(
    box,
    ...GROUPS.map(([key, title]) => {
      const rows = answers.filter((a) => a.group === key);
      return rows.length
        ? h('div', { class: 'form-group' }, h('span', { class: 'form-group-title', text: title }),
            h('ul', { class: 'answers' }, rows.map((a) => h('li', {},
              h('div', { class: 'answer-text' }, h('span', { class: 'answer-label', text: a.label }), h('span', { class: 'answer-value', text: a.value })),
              copyButton(a.value)))))
        : null;
    }),
    (res.missing || []).length
      ? h('div', { class: 'missing' },
          h('span', { text: `Not in your profile yet: ${res.missing.join(', ')}.` }),
          h('button', { class: 'link', type: 'button', text: 'Add them once in your profile →', onclick: () => open(to.route(res.profile_path || '/candidate')) }))
      : null,
    h('p', { class: 'for', text: 'Only what your ATS Engine profile says - nothing is typed into the form for you, so you check every field.' }),
  );
}

function formHelperScreen() {
  const box = h('div');
  show(
    h('div', { class: 'card' },
      h('h1', { text: 'Your form helper' }),
      h('p', { class: 'muted', text: 'Click Copy, then paste into the form (Ctrl+V).' }),
      box,
      h('button', { class: 'btn secondary', type: 'button', style: 'margin-top:12px', text: 'Back', onclick: () => homeScreen() }),
    ),
  );
  formPanel(box);
}

async function capture() {
  busy('Reading the page…');
  let page;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // In the side panel (0.4.1) a tab's address is only visible once the
    // extension may read that page, so an unknown address is not refused here.
    if (!tab?.id || (tab.url && !/^https?:/.test(tab.url))) throw new Error('Open a job advert in this tab first.');
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
      page = result?.result;
    } catch {
      // Chrome lets the extension read only the page it was opened on. On
      // another tab, one click on the icon gives it that page too.
      throw new Error('ATS Engine needs your go-ahead to read this page: click the ATS Engine icon in your toolbar once, then press Check this job again.');
    }
    if (!page?.html) throw new Error('This page could not be read.');
  } catch (err) {
    return homeScreen(err.message || 'This page could not be read.');
  }

  busy('ATS Engine is reading the job…');
  let res;
  try {
    res = await api.capture(page);
  } catch (err) {
    return handleError(err);
  }
  // Already in their ATS Engine (22 Oct 2026): show its fit straight away
  // - the same card the app shows - rather than asking to check it again.
  const before = (res.existing || [])[0];
  if (before?.id) {
    busy('You have this job already - loading your fit…');
    try {
      const job = await api.seekerJob(before.id);
      return resultScreen(job?.data || job, { known: true, recheck: () => reviewScreen(res, page) });
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      // Not readable any more - fall through to checking it as new.
    }
  }
  reviewScreen(res, page);
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

/*
 * The job stays put (0.4.1, Dennis: "the job needs to stay static until
 * the user says it is submitted or cancelled"). Whatever job is on screen
 * is pinned; opening the panel again - even after closing the browser -
 * goes straight back to it. It is let go only when they mark it applied
 * or no longer interested, or press Check another job.
 */
const PIN = 'atsEnginePinnedJob';
const pin = (job) => chrome.storage?.local?.set?.({ [PIN]: { id: job.id, title: job.title || '', company: job.company || '' } }).catch?.(() => {});
const unpin = () => chrome.storage?.local?.remove?.(PIN).catch?.(() => {});
const pinned = async () => {
  try {
    return (await chrome.storage.local.get(PIN))?.[PIN] || null;
  } catch {
    return null;
  }
};
const LET_GO = ['applied', 'withdrawn', 'rejected'];

async function backTo(job) {
  busy(`Opening ${job.title || 'your job'}…`);
  try {
    const fresh = await api.seekerJob(job.id);
    resultScreen(fresh?.data || fresh, { pinned: true });
  } catch (err) {
    if (err.status === 401) return connectScreen(err.message);
    await unpin(); // gone from ATS Engine - nothing to come back to
    homeScreen(err.status === 404 ? null : err.message);
  }
}

function resultScreen(job, opts = {}) {
  const app_ = job?.application;
  if (job?.id && !LET_GO.includes(app_?.status)) pin(job);
  const fit = job?.candidate_fit || null;
  const full = fullFit(fit);
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
  const tracker = id ? applyCard(id, job) : null;
  const advert = id && jobInsight ? h('div', { class: 'card pro-card advert-card' }, h('p', { class: 'muted', text: 'Checking the advert…' })) : null;
  if (advert) loadAdvert(advert, id);
  const company = id && jobInsight ? h('div', { class: 'card pro-card company-card' }, h('p', { class: 'muted', text: 'Looking for the company snapshot…' })) : null;
  if (company) loadCompany(company, id, job?.company);
  const insight = id ? (jobInsight ? h('div', { class: 'card pro-card' }, h('p', { class: 'muted', text: 'Job Insight is reading this job against your CV…' })) : proTeaser()) : null;
  if (id && jobInsight) loadInsight(insight, id);

  show(
    opts.pinned ? h('div', { class: 'pin-note' }, h('span', { 'aria-hidden': 'true', text: '📌' }), h('span', { text: 'Kept here while you apply. It goes when you mark it applied or not interested, or check another job.' })) : null,
    opts.known ? h('div', { class: 'seen-banner', 'data-seen': '' }, h('span', { class: 'seen-tag', text: 'SEEN BEFORE' }), h('span', { text: 'This job is already in your ATS Engine - here is your fit, and where your application is.' })) : null,
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
          : fitRing(full?.full ? full.score : s.score, full?.full ? full.tone : s.tone, full?.full),
        h('div', {}, h('h1', { text: s.headline }), h('p', { class: 'muted', style: 'margin:0', text: `${job?.title || ''}${job?.company ? ` · ${job.company}` : ''}` })),
      ),
      full ? fullFitBlock(job, full) : null,
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
    advert,
    tracker,
    company,
    insight,
    h(
      'div',
      { class: 'card' },
      s.next.kind === 'upload' ? h('button', { class: 'btn', type: 'button', text: 'Upload your CV', onclick: () => open(to.cvLibrary()) }) : null,
      id && (tailorFirst || canTailor) ? tailorBlock(id, tailorFirst) : null,
      id ? h('button', { class: `btn${tailorFirst ? ' secondary' : ''}`, type: 'button', text: 'View full analysis', onclick: () => open(to.jobAnalysis(id)) }) : null,
      opts.recheck ? h('button', { class: 'btn secondary', type: 'button', text: 'Check it again from this page', onclick: opts.recheck }) : null,
      h('button', { class: 'btn secondary', type: 'button', text: 'Check another job', onclick: async () => { await unpin(); start(); } }),
    ),
  );
}

/* The fit, big: a ring filled to the score. "tailored" marks the full fit. */
function fitRing(score, tone, tailored) {
  return h('div', { class: `num fit-ring ${tone}`, style: `--p:${Math.max(0, Math.min(100, score))}`, role: 'img', 'aria-label': `${score}% fit${tailored ? ', tailored CV' : ''}` },
    h('span', { class: 'fit-num', text: `${score}%` }), h('span', { class: 'fit-word', text: tailored ? 'full fit' : 'fit' }));
}

/*
 * The full fit (22 Oct 2026): with a tailored CV, its score and a Download
 * button; before one, a clear "this is before the full analysis" and a
 * button that makes the tailored CV here - the app's own generation - and
 * then shows the full fit, ready to download.
 */
function fullFitBlock(job, full) {
  const box = h('div', { class: `fullfit ${full.full ? 'is-full' : 'is-first'}` });
  const download = async (docId, btn) => {
    btn.disabled = true;
    try {
      const { blob, filename } = await api.downloadDocument(docId);
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename || `${job.title || 'Tailored'}-CV.docx`.replace(/\s+/g, '_') });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      box.append(notice('bad', err.message));
    } finally {
      btn.disabled = false;
    }
  };

  if (full.full) {
    const btn = h('button', { class: 'btn green', type: 'button', text: 'Download tailored CV', onclick: () => download(full.documentId, btn) });
    fill(box, h('p', { class: 'fullfit-note', text: full.note }), full.documentId ? btn : null);
    return box;
  }

  const make = async () => {
    fill(box, h('p', { class: 'fullfit-note', text: 'Making your tailored CV for this job - this takes about a minute. You can leave this open.' }), h('div', { class: 'bar' }, h('span')));
    try {
      const res = await api.generateCv(candidateId, job.id);
      const docId = (res?.data || res)?.id;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const d = await api.document(docId);
        const status = (d?.data || d)?.status;
        if (DOC_DONE.includes(status)) {
          if (status === 'failed') throw new Error('ATS Engine could not make the tailored CV this time. Try again, or make it from the job in ATS Engine.');
          const fresh = await api.seekerJob(job.id);
          return resultScreen(fresh?.data || fresh);
        }
      }
      throw new Error('This is taking longer than usual. Open the job in ATS Engine to see when it is ready.');
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      fill(box, h('p', { class: 'fullfit-note', text: full.note }), notice('bad', err.message), retry());
    }
  };
  const retry = () => h('button', { class: 'btn', type: 'button', text: 'Make my tailored CV - full analysis', onclick: make });

  fill(
    box,
    h('strong', { class: 'fullfit-head', text: 'Before the full analysis' }),
    h('p', { class: 'fullfit-note', text: full.note }),
    canTailorCv && candidateId ? retry() : h('p', { class: 'muted', text: 'Tailored CVs come with Job Seeker and Job Seeker Pro.' }),
  );
  return box;
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
    h('ul', { class: 'tips pro-pitch' }, [...INSIGHT_PITCH, ...APPLY_PRO].map((t) => h('li', { text: t }))),
    h('button', { class: 'btn gold', type: 'button', text: 'Upgrade to Job Seeker Pro', onclick: () => open(to.subscription()) }),
    h('p', { class: 'for', text: 'Everything you have now stays exactly as it is.' }),
  );
}

/*
 * Apply for this job (0.4.0) - three steps, the easiest way through:
 *   1. Fill in the form: their own details, one click to copy each.
 *   2. Screening questions (Job Seeker Pro): answered from their own CV.
 *   3. Tell us you've applied: the tracker move, and when to follow up.
 * Above the steps, the application's journey - checked, applied, follow
 * up - and "seen before" when it was checked on an earlier day.
 */
function applyCard(jobId, job = {}) {
  const head = h('div', { class: 'apply-head' }, h('h2', { text: 'Apply for this job' }));
  const path = h('div', { class: 'journey-slot' });
  const tracker = h('div', { class: 'tracker-slot' }, h('p', { class: 'muted', text: 'Checking your Application Tracker…' }));
  const form = h('div', { class: 'step-panel', hidden: true });
  let formLoaded = false;
  const formBtn = h('button', { class: 'btn-mini', type: 'button', text: 'Show my answers', 'aria-expanded': 'false' });
  formBtn.addEventListener('click', () => {
    const opening = form.hidden;
    form.hidden = !opening;
    formBtn.textContent = opening ? 'Hide my answers' : 'Show my answers';
    formBtn.setAttribute('aria-expanded', String(opening));
    if (opening && !formLoaded) {
      formLoaded = true;
      formPanel(form);
    }
  });

  const card = h(
    'div',
    { class: 'card apply-card' },
    head,
    path,
    h('ol', { class: 'apply-steps' },
      h('li', { class: 'apply-step' }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: '1' }), h('div', { class: 'step-body' },
        h('h3', { text: 'Fill in the form' }),
        h('p', { class: 'muted', text: 'Your details from your profile - click to copy, paste into the form.' }),
        formBtn, form)),
      h('li', { class: 'apply-step' }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: '2' }), h('div', { class: 'step-body' }, ...letterStep(job))),
      h('li', { class: 'apply-step' }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: '3' }), h('div', { class: 'step-body' }, ...screeningStep(jobId))),
      h('li', { class: 'apply-step' }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: '4' }), h('div', { class: 'step-body' },
        h('h3', { text: 'Tell us you’ve applied' }),
        tracker)),
    ),
    h('button', { class: 'link', type: 'button', style: 'margin-top:10px', text: 'Open Application Tracker', onclick: () => open(to.applications()) }),
  );
  loadTracker(tracker, jobId, (a) => {
    fill(path, journeyStrip(a));
    head.querySelector('.seen-tag')?.remove();
    if (seenBefore(a)) head.append(h('span', { class: 'seen-tag', text: `SEEN ${dayLabel(a.checked_on).toUpperCase()}` }));
  });
  return card;
}

function journeyStrip(a) {
  return h('ol', { class: 'journey', 'aria-label': 'Your application' }, journey(a).map((st) =>
    h('li', { class: `jstep ${st.state}` }, h('span', { class: 'jdot', 'aria-hidden': 'true', text: st.state === 'done' ? '✓' : '' }),
      h('span', { class: 'jlabel', text: st.label }), st.when ? h('span', { class: 'jwhen', text: st.when }) : null)));
}

/* Save a generated document the browser can download (the tailored CV, the cover letter). */
async function saveDocument(docId, fallbackName) {
  const { blob, filename } = await api.downloadDocument(docId);
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename || fallbackName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* Wait for a document ATS Engine is writing; resolves with its id once it is ready. */
async function untilReady(docId) {
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const d = await api.document(docId);
    const status = (d?.data || d)?.status;
    if (DOC_DONE.includes(status)) {
      if (status === 'failed') throw new Error('ATS Engine could not write it this time. Try again, or make it from the job in ATS Engine.');
      return docId;
    }
  }
  throw new Error('This is taking longer than usual. Open the job in ATS Engine to see when it is ready.');
}

/*
 * Step 2 (24 Oct 2026): the cover letter - ATS Engine's own, written for
 * this job from their CV, on every plan that makes documents. One already
 * made downloads straight away.
 */
function letterStep(job) {
  const name = `${job.title || 'Cover'}-letter.docx`.replace(/\s+/g, '_');
  const ready = (job.documents || []).find((d) => d.type === 'cover_letter' && d.is_ready);
  const box = h('div', { class: 'letter-box' });
  const download = async (id, btn) => {
    btn.disabled = true;
    try {
      await saveDocument(id, name);
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      box.append(notice('bad', err.message));
    } finally {
      btn.disabled = false;
    }
  };
  const showReady = (id) => {
    const btn = h('button', { class: 'btn-mini', type: 'button', text: 'Download my cover letter' });
    btn.addEventListener('click', () => download(id, btn));
    fill(box, h('p', { class: 'letter-ok', text: '✓ Written for this job from your CV.' }), btn);
  };
  const make = async () => {
    fill(box, h('p', { class: 'muted', text: 'Writing your cover letter - about a minute. You can carry on with the form.' }), h('div', { class: 'bar' }, h('span')));
    try {
      const res = await api.generateCv(candidateId, job.id, 'cover_letter');
      const id = await untilReady((res?.data || res)?.id);
      showReady(id);
      await saveDocument(id, name);
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      fill(box, notice('bad', err.message), writeBtn());
    }
  };
  const writeBtn = () => h('button', { class: 'btn-mini', type: 'button', text: 'Write my cover letter', onclick: make });
  if (ready) showReady(ready.id);
  else if (canTailorCv && candidateId) fill(box, writeBtn());
  else fill(box, h('p', { class: 'muted', text: 'Cover letters come with Job Seeker and Job Seeker Pro.' }));
  return [
    h('h3', { text: 'Cover letter' }),
    h('p', { class: 'muted', text: 'Written for this job from your own CV - nothing invented. Read it through before you send it.' }),
    box,
  ];
}

/*
 * Interview prep (24 Oct 2026): once it is at Got an interview, the
 * likely questions for this job (free, no AI) and answers from their own
 * CV (on the app's monthly interview-pack allowance).
 */
function prepBlock(jobId) {
  const box = h('div', { class: 'prep-box' });
  const list = (answers) => paged(answers, 3, (page) => h('ol', { class: 'prep-list' }, page.map((a) => h('li', {},
    h('strong', { text: a.question }),
    a.answer ? h('p', { class: 'prep-answer', text: a.answer }) : a.needs ? h('p', { class: 'prep-needs', text: a.needs }) : null))), 'Interview questions');
  const render = (answers, message) => {
    const asked = answers.some((a) => a.asked);
    const write = h('button', { class: 'btn-mini', type: 'button', text: asked ? 'Write the rest from my CV' : 'Write my answers from my CV' });
    write.addEventListener('click', async () => {
      write.disabled = true;
      write.textContent = 'Writing… about a minute';
      try {
        const res = await api.prepAnswers(jobId);
        render(res.answers || [], 'Answers written from your own CV. Read them aloud and make them yours.');
      } catch (err) {
        if (err.status === 401) return connectScreen(err.message);
        write.disabled = false;
        write.textContent = 'Write my answers from my CV';
        box.append(notice(err.status === 402 || err.status === 429 ? 'warn' : 'bad', err.message));
      }
    });
    fill(box,
      message ? notice('ok', message) : null,
      list(answers),
      h('div', { class: 'screen-acts' }, answers.every((a) => a.asked) ? null : write,
        h('button', { class: 'btn-mini ghost-mini', type: 'button', text: 'Open the Interview Centre', onclick: () => open(to.route(`/interviews?job=${jobId}`)) })));
  };
  const start = h('button', { class: 'btn-mini', type: 'button', text: 'Show the likely questions' });
  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      const res = await api.prepQuestions(jobId);
      render(res.answers || []);
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      start.disabled = false;
      box.append(notice('bad', err.message));
    }
  });
  fill(box, start);
  return h('div', { class: 'prep' },
    h('div', { class: 'prep-head' }, h('span', { 'aria-hidden': 'true', text: '🎤' }), h('strong', { text: 'Prepare for the interview' })),
    h('p', { class: 'muted', text: 'The questions this job is likely to bring up, with answers from your own CV.' }),
    box);
}

/* The company snapshot (24 Oct 2026, Job Seeker Pro and its trial): Company Intelligence for this employer. */
async function loadCompany(card, jobId, name) {
  const head = () => h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: `About ${name || 'the employer'}` }));
  const render = (c) => {
    if (c.status === 'ready') {
      return fill(card, head(),
        c.overview ? h('p', { style: 'margin-top:8px', text: c.overview }) : null,
        c.culture?.length ? h('div', {}, h('span', { class: 'form-group-title', text: 'What it is likely to be like' }), h('div', { class: 'chips' }, c.culture.map((t) => h('span', { class: 'chip', text: t })))) : null,
        c.recent?.length ? h('div', { style: 'margin-top:8px' }, h('span', { class: 'form-group-title', text: 'Worth knowing' }), h('ul', { class: 'tips' }, c.recent.map((t) => h('li', { text: t })))) : null,
        c.questions?.length ? h('div', { style: 'margin-top:8px' }, h('span', { class: 'form-group-title', text: 'Good questions to ask them' }), h('ul', { class: 'tips' }, c.questions.map((t) => h('li', { text: t })))) : null,
        h('p', { class: 'for', text: 'Researched by AI and not verified - check anything that matters before you rely on it.' }));
    }
    if (c.status === 'pending') {
      fill(card, head(), h('p', { class: 'muted', style: 'margin-top:8px', text: 'Researching the company - usually under a minute…' }), h('div', { class: 'screen-out' }, h('div', { class: 'bar' }, h('span'))));
      return;
    }
    const go = h('button', { class: 'btn-mini', type: 'button', text: c.status === 'failed' ? 'Try again' : 'Get the company snapshot' });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        render(await api.companyRequest(jobId));
        poll();
      } catch (err) {
        if (err.status === 401) return connectScreen(err.message);
        go.disabled = false;
        card.append(notice('bad', err.message));
      }
    });
    fill(card, head(), h('p', { class: 'muted', style: 'margin-top:8px', text: c.status === 'failed' ? 'The snapshot could not be made just now.' : 'What they do, what it is likely to be like, and good questions to ask - before you apply or interview.' }), go);
  };
  const poll = async () => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const c = await api.company(jobId);
        if (c.status !== 'pending') return render(c);
      } catch {
        return;
      }
    }
  };
  try {
    const c = await api.company(jobId);
    render(c);
    if (c.status === 'pending') poll();
  } catch (err) {
    if (err.status === 401) return connectScreen(err.message);
    if (err.status === 402) return card.remove();
    fill(card, head(), notice('bad', err.message));
  }
}

/* Step 3: a screening question answered from their own record - Job Seeker Pro. */
function screeningStep(jobId) {
  if (!jobInsight) {
    return [
      h('h3', {}, 'Screening questions ', h('span', { class: 'pro-tag', text: 'PRO' })),
      h('p', { class: 'muted', text: '“Tell us about a time you…” - answered from your own CV, never made up. With Job Seeker Pro, free in the 14-day trial.' }),
      h('button', { class: 'btn-mini gold-mini', type: 'button', text: 'See Job Seeker Pro', onclick: () => open(to.subscription()) }),
    ];
  }
  const q = h('textarea', { class: 'screen-q', rows: '3', placeholder: 'Paste the question from the form, or highlight it on the page…', 'aria-label': 'The screening question' });
  const out = h('div', { class: 'screen-out', 'aria-live': 'polite' });
  const write = h('button', { class: 'btn-mini', type: 'button', text: 'Write my answer' });
  const grab = h('button', { class: 'btn-mini ghost-mini', type: 'button', text: 'Use the text I highlighted' });
  grab.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(window.getSelection?.() || '').trim() });
      if (r?.result) q.value = r.result.slice(0, 1000);
      else fill(out, notice('warn', 'Highlight the question on the page first, then press this again.'));
    } catch {
      fill(out, notice('warn', 'This page cannot be read - paste the question instead.'));
    }
  });
  write.addEventListener('click', async () => {
    const question = q.value.trim();
    if (question.length < 8) return fill(out, notice('warn', 'Paste the whole question first.'));
    write.disabled = true;
    write.textContent = 'Writing…';
    fill(out, h('div', { class: 'bar' }, h('span')));
    try {
      const res = await api.screeningAnswer(jobId, question);
      if (res.answer) {
        fill(out, h('div', { class: 'screen-answer' },
          h('p', { class: 'screen-text', text: res.answer }),
          h('div', { class: 'screen-foot' },
            h('span', { class: 'muted', text: `From ${res.sources} thing${res.sources === 1 ? '' : 's'} on your record. Read it through and make it yours.` }),
            copyButton(res.answer, 'Copy answer'))));
      } else {
        fill(out, h('div', { class: 'cover warn' }, h('strong', { text: 'Not enough on your record for this one' }), h('span', { text: res.needs }),
          h('button', { class: 'btn-mini', type: 'button', text: 'Add a story in the Interview Centre →', onclick: () => open(to.route('/interviews')) })));
      }
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      if (err.status === 402 && err.code === 'plan_feature_unavailable') return fill(out, notice('warn', err.message));
      fill(out, notice('bad', err.message));
    } finally {
      write.disabled = false;
      write.textContent = 'Write my answer';
    }
  });
  return [
    h('h3', {}, 'Screening questions ', h('span', { class: 'pro-tag', text: 'PRO' })),
    h('p', { class: 'muted', text: 'Answered from your own CV and STAR stories - nothing invented.' }),
    q,
    h('div', { class: 'screen-acts' }, write, grab),
    out,
  ];
}

/* Step 4: where it is in the tracker, the moves ATS Engine allows, the follow-up day - and interview prep once there is an interview. */
async function loadTracker(card, jobId, onApplication = () => {}) {
  const render = (a, message) => {
    onApplication(a);
    const st = STATUS[a.status] || { tone: 'warn' };
    const chosen = followUpDays(a);
    fill(
      card,
      h('p', { class: 'tracker-line' }, 'In your tracker: ', h('span', { class: `pill ${st.tone}`, text: statusLabel(a.status) }), a.applied_on ? ` · applied ${dayLabel(a.applied_on)}` : ''),
      message ? notice('ok', message) : null,
      a.status === 'applied' && a.follow_up_on
        ? h('div', { class: 'follow' },
            h('span', { class: 'follow-q', text: 'Remind me to follow up after' }),
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Follow-up reminder' }, FOLLOW_UP.map((f) => h('button', {
              class: `seg-btn${chosen === f.days ? ' on' : ''}`, type: 'button', 'aria-pressed': String(chosen === f.days), text: f.label,
              onclick: async () => {
                try {
                  render(await api.followUp(jobId, f.days), null);
                } catch (err) {
                  if (err.status === 401) return connectScreen(err.message);
                  card.append(notice('bad', err.message));
                }
              },
            }))),
            h('span', { class: 'follow-when', text: `ATS Engine will remind you on ${dayLabel(a.follow_up_on)} (${relative(a.follow_up_on)}).` }))
        : null,
      a.status === 'interviewing' ? prepBlock(jobId) : null,
      ...(a.next || []).map((n) =>
        h('button', {
          class: `btn ${n === 'applied' ? 'green' : 'secondary'}`.trim(),
          type: 'button',
          text: MOVE[n] || n,
          onclick: async () => {
            try {
              const moved = await api.setStatus(jobId, n);
              if (LET_GO.includes(moved.status)) unpin();
              render(moved, n === 'applied' ? `Marked as applied on ${dayLabel(moved.applied_on)}. Good luck!` : `Moved to ${statusLabel(moved.status)}.`);
            } catch (err) {
              if (err.status === 401) return connectScreen(err.message);
              if (err.status === 402) return planScreen(err.message);
              render(err.body?.application || a, null);
              card.append(notice('bad', err.message));
            }
          },
        }),
      ),
    );
  };
  try {
    render(await api.seekerApplication(jobId));
  } catch (err) {
    if (err.status === 401) return connectScreen(err.message);
    if (err.status === 402) return planScreen(err.message);
    fill(card, h('p', { class: 'muted', text: err.status === 404 ? 'This job is not in your Application Tracker yet.' : err.message }));
  }
}

/* The advert check (0.4.0, Job Seeker Pro and its trial): the closing date and the warning signs. */
async function loadAdvert(card, jobId) {
  let res;
  try {
    res = await api.advertCheck(jobId);
  } catch (err) {
    if (err.status === 401) return connectScreen(err.message);
    if (err.status === 402) return card.remove();
    return fill(card, h('h2', { text: 'Advert check' }), notice('bad', err.message));
  }
  const badge = closingBadge(res.closing);
  const real = (res.signs || []).filter((x) => x.level !== 'info');
  const info = (res.signs || []).filter((x) => x.level === 'info');
  fill(
    card,
    h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: 'Advert check' })),
    badge
      ? h('div', { class: `closing ${badge.tone}` },
          h('div', { class: 'cal', 'aria-hidden': 'true' }, h('span', { class: 'cal-m', text: badge.month }), h('span', { class: 'cal-d', text: String(badge.day) })),
          h('div', {}, h('strong', { text: badge.text }), h('span', { text: badge.sub }),
            res.reminder ? h('span', { class: 'closing-rem', text: '🔔 We’ll remind you two days before, if you haven’t applied.' }) : null))
      : h('div', { class: 'closing none' }, h('div', { class: 'cal', 'aria-hidden': 'true' }, h('span', { class: 'cal-m', text: 'DATE' }), h('span', { class: 'cal-d', text: '?' })),
          h('div', {}, h('strong', { text: 'No closing date given' }), h('span', { text: 'Adverts like this can close without warning - apply sooner rather than later.' }))),
    real.length
      ? h('ul', { class: 'signs' }, real.map((x) => h('li', { class: `sign ${SIGN[x.level].tone}` },
          h('span', { class: 'sign-ico', 'aria-hidden': 'true', text: SIGN[x.level].symbol }),
          h('div', {}, h('strong', { text: x.title }), h('span', { text: x.why }), x.found ? h('q', { class: 'sign-found', text: x.found }) : null))))
      : h('div', { class: 'signs-clear' }, h('span', { class: 'sign-ico', 'aria-hidden': 'true', text: '✓' }), h('span', { text: 'No warning signs found in this advert.' })),
    ...info.map((x) => h('p', { class: 'sign-info', text: `${x.title} - ${x.why}` })),
    h('p', { class: 'for', text: 'Read from the advert’s own words. Things to check, not a verdict.' }),
  );
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
    candidateId = me.candidate_id || null;
    canTailorCv = me.documents === true;
    showWho({ ...connection, user: me.user });
    const keep = await pinned();
    if (keep?.id) return backTo(keep);
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
