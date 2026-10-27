/*
 * ATS Engine - Recruiters - the popup (Phase 1, 21 Oct 2026).
 *
 *   Connect  ->  Capture job  ->  review and edit  ->  possible duplicates
 *            ->  Create vacancy / Update existing / Create anyway
 *            ->  Open in ATS Engine, Advert Health
 *
 * A thin client: it reads the page, shows what ATS Engine found, and
 * sends the recruiter's reviewed fields back. Every rule - extraction,
 * duplicates, saving, analysis - lives in ATS Engine. Nothing the page or
 * the API returns is ever written into the popup as HTML: every word goes
 * in through textContent.
 */
import { CONFIG } from './core/config.js';
import { createApi } from './core/api.js';
import { mountAlerts } from './core/alerts-ui.js';
import { getConnection, clearConnection, connectLink, onConnectionChange } from './core/connection.js';
import { readPage } from './core/page-reader.js';
import { VACANCY_FIELDS, DUPLICATE_REASONS, CANDIDATE_FIELDS, MATCH_REASONS, cleanFields, cleanCandidate, missingRequired } from './core/fields.js';
import { h, notice, fill, paged } from './core/dom.js';
import { reviewForm } from './core/review-form.js';
import { links } from './core/links.js';
import { advertChecks, advertImprovements, matchSummary, professionalSummary, candidateSummary, CHECK_STATUS } from './core/intelligence.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const foot = document.getElementById('foot');
const to = links(CONFIG.appBase);

// What this account may use (ATS Engine Professional, 22 Oct 2026), from
// /extension/me. Only decides what is offered - the server refuses anything
// the account does not have.
let caps = [];
const isPro = () => caps.includes('intelligence_centre');

const api = createApi({
  baseUrl: CONFIG.apiBase,
  getToken: async () => (await getConnection())?.token || '',
  onUnauthorised: () => clearConnection(),
});

// Messages and new inbox emails waiting in ATS Engine (26 Oct 2026).
mountAlerts({ api, appBase: CONFIG.appBase, getConnection });

function show(...nodes) {
  fill(app, ...nodes);
}

function open(url) {
  chrome.tabs.create({ url });
}

// ---- screens ---------------------------------------------------------------
function connectScreen(message) {
  // Before sign-in the header says which login this is (Dennis, 21 Oct 2026).
  who.replaceChildren(h('strong', { class: 'login-label', text: 'Recruiter Login' }));
  who.hidden = false;
  foot.hidden = true;
  show(
    message ? notice('warn', message) : null,
    h(
      'div',
      { class: 'card' },
      h('h1', { text: 'Capture jobs straight into ATS Engine' }),
      h('p', { class: 'muted', text: 'See a vacancy anywhere on the web, click once, review it, and it is in your ATS Engine desk.' }),
      h('button', {
        class: 'btn',
        type: 'button',
        text: 'Connect to ATS Engine',
        onclick: async () => open(await connectLink(CONFIG.appBase, chrome.runtime, chrome.storage.local, CONFIG.connectId || chrome.runtime.id)),
      }),
      h('p', { class: 'muted', style: 'margin-top:10px', text: 'Opens ATS Engine in a new tab. Sign in there if asked, press Connect, then come back here.' }),
      h('p', { class: 'for', text: 'For recruiter accounts. Looking for a job? Use ATS Engine - Seekers instead.' }),
    ),
  );
}

function homeScreen(connection, message) {
  showWho(connection);
  show(
    message ? notice('bad', message) : null,
    h(
      'div',
      { class: 'card' },
      h('h1', { text: 'Capture this job' }),
      h('p', { class: 'muted', text: 'Reads the advert on the page you are on. Nothing is saved until you have checked it. Tip: highlight the job description first on sites that hide it.' }),
      h('button', { class: 'btn', type: 'button', text: 'Capture job', onclick: capture }),
    ),
    (proSlot = h('div')),
  );
  fillProSlot();
}

// The Professional card arrives once /extension/me has said what the account has.
let proSlot = null;
function fillProSlot() {
  if (!proSlot || !document.contains(proSlot)) return;
  proSlot.replaceChildren(
    isPro()
      ? h(
          'div',
          { class: 'card pro-card' },
          h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: 'Looking at a candidate?' })),
          h('p', { class: 'muted', text: 'Check whether they are already in ATS Engine, see where they fit your open vacancies, and add them if they are new. Nothing is saved until you confirm. Tip: highlight their profile first for the best match. LinkedIn is not read.' }),
          h('button', { class: 'btn gold', type: 'button', text: 'Capture candidate', onclick: captureCandidate }),
        )
      : '',
  );
}

// ---- ATS Engine Professional (E2): a candidate on another site ---------------
async function captureCandidate() {
  busy('Reading the page…');
  let page;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error("Open the candidate's page in this tab first.");
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    page = result?.result;
    if (!page?.html) throw new Error('This page could not be read.');
  } catch (err) {
    return homeScreen(await getConnection(), err.message || 'This page could not be read.');
  }
  busy('ATS Engine is reading the profile…');
  try {
    candidateReview(await api.captureCandidate(page));
  } catch (err) {
    handleError(err);
  }
}

function candidateReview(res) {
  const values = { ...(res.fields || {}) };
  const inputs = {};
  const nodes = CANDIDATE_FIELDS.map((f) => {
    const id = `c-${f.key}`;
    const control = h('input', { id, type: f.key === 'email' ? 'email' : 'text', placeholder: 'Not found on the page' });
    control.value = values[f.key] || '';
    inputs[f.key] = control;
    return h('div', {}, h('label', { for: id }, f.label, f.required ? h('span', { class: 'req', text: ' *' }) : null), control);
  });
  const read = () => {
    const v = { profile_text: values.profile_text || '' };
    for (const [k, el] of Object.entries(inputs)) v[k] = el.value;
    return v;
  };
  const status = h('div');
  const chars = (values.profile_text || '').length;

  show(
    h(
      'div',
      { class: 'card' },
      h('h1', { text: 'Check this candidate' }),
      h('p', { class: 'muted', text: 'Check the details below. Nothing is saved - this only looks them up in ATS Engine.' }),
      nodes,
      h('p', { class: 'source', style: 'margin-top:10px', text: `${res.used_selection ? 'Your highlighted text' : 'The page text'} (${chars} characters) is matched against your vacancies · from ${values.source_site || ''}` }),
      status,
      h('button', {
        class: 'btn gold', type: 'button', text: 'Check against ATS Engine',
        onclick: async () => {
          status.replaceChildren(notice('ok', 'Looking them up…'));
          try {
            const fields = cleanCandidate(read());
            contextScreen(await api.candidateContext(fields), fields);
          } catch (err) {
            if (err.status === 401) return connectScreen(err.message);
            if (err.status === 402 && err.code === 'plan_feature_unavailable') return show(proOffer(err.message));
            status.replaceChildren(notice('bad', err.message));
          }
        },
      }),
      h('button', { class: 'btn secondary', type: 'button', text: 'Cancel', onclick: start }),
    ),
  );
}

function contextScreen(ctx, fields) {
  const s = candidateSummary(ctx);
  const go = (path) => () => open(to.route(path));
  const section = (title, ...nodes) => [h('h2', { style: 'margin-top:12px', text: title }), ...nodes];
  const addArea = h('div');

  const addFlow = () => {
    const missing = CANDIDATE_FIELDS.filter((f) => f.required && !fields[f.key]).map((f) => f.label);
    if (missing.length) {
      addArea.replaceChildren(notice('bad', `Add their ${missing.join(' and ').toLowerCase()} first - go back and fill ${missing.length === 1 ? 'it' : 'them'} in.`));
      return;
    }
    addArea.replaceChildren(
      h('div', { class: 'confirm' },
        h('strong', { text: 'Add this person to your Talent Pool?' }),
        h('span', { text: [fields.full_name, fields.email, fields.phone, fields.town].filter(Boolean).join(' · ') }),
        s.maybe.length ? h('span', { class: 'muted', text: `Check they are not one of the ${s.maybe.length} similar ${s.maybe.length === 1 ? 'name' : 'names'} above first.` }) : null,
        h('div', { class: 'tri' },
          h('button', {
            class: 'btn green', type: 'button', text: 'Yes, add them',
            onclick: async () => {
              addArea.replaceChildren(notice('ok', 'Adding to your Talent Pool…'));
              try {
                const res = await api.addCandidate(fields);
                const id = res?.candidate?.id;
                addArea.replaceChildren(notice('ok', `${fields.full_name} is in your Talent Pool.`), id ? h('button', { class: 'btn-mini', type: 'button', text: 'Open their record →', onclick: () => open(to.candidate(id)) }) : null);
              } catch (err) {
                if (err.status === 401) return connectScreen(err.message);
                addArea.replaceChildren(notice('bad', err.message));
              }
            },
          }),
          h('button', { class: 'btn secondary', type: 'button', text: 'Not now', onclick: () => addArea.replaceChildren(addButton()) }),
        )),
    );
  };
  const addButton = () => h('button', { class: 'btn green', type: 'button', text: 'Add to Talent Pool', onclick: addFlow });

  show(
    h(
      'div',
      { class: 'card pro-card' },
      h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: fields.full_name || 'This candidate' })),

      s.known
        ? h('div', { class: 'cover ok' }, h('strong', { text: s.known.headline }),
            h('span', { text: `${s.known.apps.length} application${s.known.apps.length === 1 ? '' : 's'} · ${s.known.submissions} sent to clients · ${s.known.opportunities} open ${s.known.opportunities === 1 ? 'opportunity' : 'opportunities'}` }),
            h('button', { class: 'btn-mini', type: 'button', text: 'Open their record →', onclick: go(s.known.destination) }))
        : h('div', { class: 'cover warn' }, h('strong', { text: s.maybe.length ? 'Possibly already in ATS Engine' : 'Not in your Talent Pool yet' }),
            h('span', { text: s.maybe.length ? 'A similar name is on file - check below before adding.' : 'Nobody with this email, phone or a similar name.' })),

      ...(s.maybe.length
        ? section('Could be the same person', paged(s.maybe, PER_PAGE, (page) => h('ul', { class: 'pro-list' }, page.map((m) => h('li', {},
            h('div', { class: 'pro-row' }, h('span', { class: 'pill warn', text: MATCH_REASONS[m.reason] || m.reason }), h('strong', { text: m.name || 'Unnamed' })),
            h('span', { class: 'muted', text: [m.headline, m.town, `${m.applications} applications`, m.live ? `${m.live} live` : null, m.recruiter ? `with ${m.recruiter}` : null].filter(Boolean).join(' · ') }),
            h('button', { class: 'btn-mini', type: 'button', text: 'View →', onclick: go(m.destination) }),
          ))), 'Possible matches'))
        : []),

      ...(s.known && s.known.apps.length
        ? section(`Their applications (${s.known.apps.length})`, paged(s.known.apps, PER_PAGE, (page) => h('ul', { class: 'pro-list' }, page.map((a) => h('li', {},
            h('div', { class: 'pro-row' }, h('span', { class: 'pill muted', text: a.statusLabel }), h('strong', { text: a.role || 'Role' })),
            h('span', { class: 'muted', text: [a.company, a.applied_on].filter(Boolean).join(' · ') }),
            h('button', { class: 'btn-mini', type: 'button', text: 'Open →', onclick: go(a.destination) }),
          ))), 'Applications'))
        : []),

      ...(s.known && s.known.gaps.length
        ? section(`Their open gaps (${s.known.gaps.length})`, paged(s.known.gaps, PER_PAGE, (page) => h('ul', { class: 'pro-list gaplist' }, page.map((g) => h('li', {},
            h('div', { class: 'pro-row' }, h('span', { class: `pill ${g.tone}`, text: g.severity }), h('strong', { text: g.title })),
            g.why ? h('span', { class: 'muted', text: g.why }) : null,
            g.destination ? h('button', { class: 'btn-mini', type: 'button', text: `${g.action_label || 'Open'} →`, onclick: go(g.destination) }) : null,
          ))), 'Their gaps'))
        : []),

      ...section(`Where they fit (${s.fitTotal})`,
        s.unreadable
          ? h('p', { class: 'muted', text: 'Nothing to match yet - highlight their profile or experience on the page and capture again.' })
          : s.fits.length
            ? paged(s.fits, PER_PAGE, (page) => h('ul', { class: 'pro-list' }, page.map((f) => h('li', {},
                h('div', { class: 'pro-row' }, h('span', { class: 'sc green', text: `${f.score}%` }), h('strong', { text: f.title })),
                h('span', { class: 'muted', text: [f.client, f.already ? 'already in this one' : null].filter(Boolean).join(' · ') }),
                f.matched?.length ? h('div', { class: 'chips' }, f.matched.map((x) => h('span', { class: 'chip', text: x }))) : null,
                h('button', { class: 'btn-mini', type: 'button', text: 'Open vacancy →', onclick: go(f.destination) }),
              ))), 'Where they fit')
            : h('p', { class: 'muted', text: 'None of your open vacancies reaches your minimum match score for them.' }),
        s.fromPage && s.fits.length ? h('p', { class: 'muted', text: 'Scored from the page text, with the same fit as Match my database.' }) : null,
      ),

      ...(s.steps.length
        ? section(`Next steps (${s.steps.length})`, paged(s.steps, PER_PAGE, (page) => h('ol', { class: 'steps' }, page.map((a) => h('li', {},
            h('div', { class: 'step-top' }, h('span', { class: `pill ${a.band}`, text: a.bandLabel }), h('span', { class: 'pts', title: a.parts.join(' · '), text: `${a.points} pts` })),
            h('strong', { text: a.title }),
            a.reason ? h('span', { class: 'muted', text: a.reason }) : null,
            a.destination ? h('button', { class: 'btn-mini', type: 'button', text: `${a.action} →`, onclick: go(a.destination) }) : null,
          ))), 'Next steps'))
        : []),

      s.known ? null : h('div', { style: 'margin-top:12px' }, addArea),
    ),
    h('div', { class: 'card' }, h('button', { class: 'btn secondary', type: 'button', text: 'Check another candidate', onclick: captureCandidate }), h('button', { class: 'btn secondary', type: 'button', text: 'Back', onclick: start })),
  );
  if (!s.known) addArea.replaceChildren(addButton());
}

function showWho(connection) {
  const u = connection?.user || {};
  who.replaceChildren(h('strong', { text: u.name || '' }), document.createTextNode(u.organisation || ''));
  who.hidden = false;
  foot.hidden = false;
}

function busy(text) {
  show(h('div', { class: 'card' }, h('p', { class: 'muted', text })));
}

async function capture() {
  busy('Reading the page…');
  let page;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || '')) {
      throw new Error('Open a job advert in this tab first.');
    }
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    page = result?.result;
    if (!page?.html) throw new Error('This page could not be read.');
  } catch (err) {
    return homeScreen(await getConnection(), err.message || 'This page could not be read.');
  }

  busy('ATS Engine is reading the advert…');
  try {
    const res = await api.capture(page);
    reviewScreen(res, page);
  } catch (err) {
    handleError(err);
  }
}

function reviewScreen(res, page) {
  const values = { ...res.fields };
  if (!res.is_job_page && page.selection && !values.description) {
    values.description = page.selection;
  }
  const form = reviewForm(values);
  const fieldNodes = form.nodes;
  const read = form.read;

  const status = h('div');
  const submit = async (action, existingId) => {
    const v = read();
    const missing = missingRequired(v);
    if (action !== 'fill' && missing.length) {
      status.replaceChildren(notice('bad', `Add ${missing.join(', ')} before saving.`));
      return;
    }
    status.replaceChildren(notice('ok', 'Saving to ATS Engine…'));
    try {
      const fields = cleanFields(v);
      const saved =
        action === 'fill'
          ? await api.fillVacancy(existingId, fields)
          : await api.createVacancy(fields, { createNew: action === 'create_new' });
      doneScreen(saved?.data || saved);
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      if (err.status === 402) return planScreen(err.message);
      status.replaceChildren(notice('bad', err.message));
    }
  };

  const existing = res.existing || [];
  const dupCard = existing.length
    ? h(
        'div',
        { class: 'card' },
        h('h2', { text: 'Possible duplicate' }),
        h('p', { class: 'muted', text: 'This vacancy may already be in ATS Engine.' }),
        existing.map((e) =>
          h(
            'div',
            { class: 'dup' },
            h('div', { class: 't', text: `${e.title || 'Untitled'} - ${e.company || ''}` }),
            h('div', { class: 'muted', text: [e.location, DUPLICATE_REASONS[e.reason] || e.reason, e.status].filter(Boolean).join(' · ') }),
            h(
              'div',
              { class: 'actions' },
              // Buttons, not links (Dennis, 22 Oct 2026). View existing opens
              // Job Postings with this vacancy's card open, on page load.
              h('button', { class: 'btn-mini', type: 'button', text: 'View existing →', onclick: () => open(to.vacancy(e.id)) }),
              h('button', { class: 'btn-mini', type: 'button', text: 'Update this one', onclick: () => submit('fill', e.id) }),
            ),
          ),
        ),
      )
    : null;

  const notFound = (res.not_found || []).filter((k) => VACANCY_FIELDS.some((f) => f.key === k));

  show(
    !res.is_job_page ? notice('warn', 'This does not look like a job advert. You can still fill it in by hand.') : null,
    ...(res.warnings || []).map((w) => notice('warn', w)),
    dupCard,
    h(
      'div',
      { class: 'card' },
      h('h1', { text: res.is_job_page ? 'Job captured' : 'Capture this page' }),
      notFound.length ? h('p', { class: 'muted' }, h('span', { class: 'pill warn', text: `${notFound.length} not on the page` }), ' Check the empty fields below.') : null,
      fieldNodes,
      h('p', { class: 'source', style: 'margin-top:10px', text: `From ${res.fields?.source_site || ''}` }),
      status,
      existing.length
        ? h('button', { class: 'btn secondary', type: 'button', text: 'Create a new vacancy anyway', onclick: () => submit('create_new') })
        : h('button', { class: 'btn green', type: 'button', text: 'Create vacancy', onclick: () => submit('create') }),
      // Open in ATS Engine (22 Oct 2026): Job Postings, on page load, with
      // the existing card open - or, if it is not there yet, the Add a
      // vacancy form filled with what is on this screen (nothing saved).
      h('button', {
        class: 'btn secondary', type: 'button', text: existing.length ? 'Open the existing one in ATS Engine' : 'Open in ATS Engine to finish there',
        onclick: () => open(existing.length ? to.vacancy(existing[0].id) : to.newVacancy(cleanFields(read()))),
      }),
    ),
  );
}

function doneScreen(job) {
  const id = job?.id;
  const how = job?._dedup_status || job?.dedup_status;
  const title = how === 'unchanged' ? 'Already up to date' : how === 'updated' ? 'Vacancy updated' : 'Vacancy created';
  const panel = h('div');

  // Phase 2: ATS Engine's own engines, one click each, shown below.
  const run = (label, call, render) => async () => {
    panel.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted', text: `${label}…` })));
    try {
      panel.replaceChildren(render(await call()));
    } catch (err) {
      if (err.status === 401) return connectScreen(err.message);
      if (err.status === 402 && err.code === 'plan_feature_unavailable') return panel.replaceChildren(proOffer(err.message));
      if (err.status === 402) return planScreen(err.message);
      panel.replaceChildren(notice('bad', err.message));
    }
  };

  show(
    h(
      'div',
      { class: 'card' },
      h('h1', { text: title }),
      h('p', {}, h('strong', { text: job?.title || '' }), job?.location ? ` · ${job.location}` : '', job?.salary ? ` · ${job.salary}` : ''),
      how === 'unchanged' ? h('p', { class: 'muted', text: 'Everything on the page was already on the vacancy.' }) : null,
      id ? h('div', { class: 'tri' },
        h('button', { class: 'btn', type: 'button', text: 'Match my database', onclick: run('Matching your candidates', () => api.matchDatabase(id), (r) => matchPanel(r, id)) }),
        h('button', { class: 'btn secondary', type: 'button', text: 'Advert Health', onclick: run('Running Advert Health', () => api.advertHealth(id), (r) => advertPanel(r, id)) }),
        h('button', { class: 'btn secondary', type: 'button', text: 'Job Analysis', onclick: run('Reading the vacancy', () => api.jobAnalysis(id), (r) => analysisPanel(r, id)) }),
      ) : null,
      id && isPro()
        ? h('button', { class: 'btn gold', type: 'button', style: 'margin-top:8px', text: 'Professional insight', onclick: run('Working out coverage, gaps and next steps', () => api.vacancyIntelligence(id), (r) => proPanel(r, id)) })
        : null,
      id && !isPro() ? h('p', { class: 'pro-tease' }, h('span', { class: 'pro-tag', text: 'PRO' }), ' With ATS Engine Professional: who in your pool fits this vacancy, the gaps that will stop a shortlist, and what to do next.') : null,
    ),
    panel,
    h(
      'div',
      { class: 'card' },
      id ? h('button', { class: 'btn secondary', type: 'button', text: 'Open in ATS Engine', onclick: () => open(to.vacancy(id)) }) : null,
      h('button', { class: 'btn secondary', type: 'button', text: 'Capture another job', onclick: start }),
    ),
  );
}

function matchPanel(res, jobId) {
  const s = matchSummary(res);
  return h(
    'div',
    { class: 'card' },
    h('h2', { text: s.headline }),
    s.detail ? h('p', { class: 'muted', text: s.detail }) : null,
    s.rows.length ? h('div', { class: 'bands' }, s.rows.map((r) => h('div', { class: `bandrow ${r.band}` }, h('strong', { text: String(r.count) }), h('span', { text: r.label })))) : null,
    s.top.length ? h('h2', { style: 'margin-top:12px', text: 'Best matches' }) : null,
    s.top.length
      ? h('ul', { class: 'people' }, s.top.map((c) => h('li', {},
          h('span', { class: `sc ${c.band}`, text: `${c.score}%` }),
          h('span', { class: 'who' }, h('strong', { text: c.name || 'Unnamed' }), h('span', { class: 'muted', text: [c.headline, c.location].filter(Boolean).join(' · ') })),
          h('button', { class: 'link', type: 'button', text: 'View', onclick: () => open(to.candidate(c.id)) }),
        )))
      : null,
    h('p', { class: 'muted', style: 'margin-top:8px', text: 'Scored with the same fit as the Job Analysis card, against your desk minimum.' }),
    h('button', { class: 'link', type: 'button', text: 'Open the vacancy in ATS Engine', onclick: () => open(to.vacancy(jobId)) }),
  );
}

function advertPanel(report, jobId) {
  const checks = advertChecks(report);
  const tips = advertImprovements(report);
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'score' }, h('div', { class: `num ${report.overall_score >= 75 ? 'ok' : report.overall_score >= 50 ? 'warn' : 'bad'}`, text: String(Math.round(report.overall_score)) }), h('div', {}, h('h2', { text: 'Advert Health' }), h('p', { class: 'muted', style: 'margin:0', text: `out of 100 · ${report.country} wording checks` }))),
    h('ul', { class: 'reqs' }, checks.map((c) => {
      const st = CHECK_STATUS[c.status];
      return h('li', { title: c.suggestion || '' }, h('span', { text: c.label }), h('span', { class: `band ${st.tone}`, text: `${st.symbol} ${st.label}` }));
    })),
    tips.length ? h('h2', { style: 'margin-top:12px', text: 'Biggest improvements' }) : null,
    tips.length ? h('ul', { class: 'tips' }, tips.map((t) => h('li', {}, h('strong', { text: t.label }), t.suggestion ? ` - ${t.suggestion}` : ''))) : null,
    h('p', { class: 'muted', style: 'margin-top:8px', text: 'Warnings are things to review, not legal findings.' }),
    h('button', { class: 'link', type: 'button', text: 'Open Advert Health in ATS Engine', onclick: () => open(to.advertHealth(jobId, report.country)) }),
  );
}

function analysisPanel(a, jobId) {
  const list = (title, items) => (items && items.length ? [h('h2', { style: 'margin-top:10px', text: title }), h('div', { class: 'chips' }, items.map((x) => h('span', { class: 'chip', text: x })))] : []);
  const facts = [
    a.years_experience_required ? `${a.years_experience_required}+ years' experience` : null,
    a.seniority ? `${a.seniority.charAt(0).toUpperCase()}${a.seniority.slice(1)} level` : null,
    a.location, a.job_type, a.hours, a.salary,
  ].filter(Boolean);
  const nothing = !(a.must_have?.length || a.nice_to_have?.length || a.skills?.length);
  return h(
    'div',
    { class: 'card' },
    h('h2', { text: 'Job Analysis' }),
    facts.length ? h('p', { class: 'muted', text: facts.join(' · ') }) : null,
    ...list('Essential', a.must_have),
    ...list('Desirable', a.nice_to_have),
    ...list('Skills mentioned', (a.skills || []).filter((s) => !(a.must_have || []).includes(s) && !(a.nice_to_have || []).includes(s))),
    nothing ? h('p', { class: 'muted', text: "ATS Engine couldn't pick out requirements from this advert. Add them to the vacancy in ATS Engine to match candidates against them." }) : null,
    h('button', { class: 'link', type: 'button', style: 'margin-top:8px', text: 'Open full analysis in ATS Engine', onclick: () => open(to.vacancy(jobId)) }),
  );
}

/* ATS Engine Professional (E1): a vacancy's coverage, gaps, strong matches and next steps. */
// Each list shows this many at a time, with Previous / Next under it.
const PER_PAGE = 3;

function proPanel(res, jobId) {
  const s = professionalSummary(res);
  const go = (path) => () => open(to.route(path));
  const section = (title, ...nodes) => [h('h2', { style: 'margin-top:12px', text: title }), ...nodes];
  return h(
    'div',
    { class: 'card pro-card' },
    h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: 'Professional insight' })),
    s.unread ? h('p', { class: 'muted', text: s.unread }) : null,
    s.commercial ? h('p', { class: s.commercial.restricted ? 'commercial restricted' : 'commercial', text: s.commercial.label }) : null,
    s.coverage ? h('div', { class: `cover ${s.coverage.tone}` }, h('strong', { text: s.coverage.headline }), s.coverage.detail && s.coverage.tone !== 'ok' ? h('span', { text: s.coverage.detail }) : null) : null,
    ...(s.missing.length ? section('Must-haves nobody in your pool shows', h('div', { class: 'chips' }, s.missing.map((x) => h('span', { class: 'chip warn', text: x }))), s.missingWhy ? h('p', { class: 'muted', text: s.missingWhy }) : null) : []),
    ...(s.steps.length
      ? section(`Next steps (${s.steps.length})`, paged(s.steps, PER_PAGE, (page) => h('ol', { class: 'steps' }, page.map((a) => h('li', {},
          h('div', { class: 'step-top' }, h('span', { class: `pill ${a.band}`, text: a.bandLabel }), h('span', { class: 'pts', title: a.parts.join(' · '), text: `${a.points} pts` })),
          h('strong', { text: a.title }),
          a.reason ? h('span', { class: 'muted', text: a.reason }) : null,
          a.destination ? h('button', { class: 'btn-mini', type: 'button', text: `${a.action} →`, onclick: go(a.destination) }) : null,
        ))), 'Next steps'))
      : []),
    ...(s.matches
      ? section(`Strong matches not yet approached (${s.matches.total})`,
          s.matches.items.length
            ? paged(s.matches.items, PER_PAGE, (page) => h('ul', { class: 'pro-list' }, page.map((c) => h('li', {},
                h('div', { class: 'pro-row' }, h('span', { class: 'sc green', text: `${c.score}%` }), h('strong', { text: c.name || 'Unnamed' })),
                [c.headline, c.town].filter(Boolean).length ? h('span', { class: 'muted', text: [c.headline, c.town].filter(Boolean).join(' · ') }) : null,
                h('button', { class: 'btn-mini', type: 'button', text: 'View →', onclick: go(c.destination) }),
              ))), 'Strong matches')
            : h('p', { class: 'muted', text: 'Nobody new: everyone who meets your minimum has already applied or been put forward.' }))
      : []),
    ...(s.gaps.length
      ? section(`Open gaps on this vacancy (${s.gaps.length})`, paged(s.gaps, PER_PAGE, (page) => h('ul', { class: 'pro-list gaplist' }, page.map((g) => h('li', {},
          h('div', { class: 'pro-row' }, h('span', { class: `pill ${g.tone}`, text: g.severity }), h('strong', { text: g.title })),
          g.why ? h('span', { class: 'muted', text: g.why }) : null,
          g.destination ? h('button', { class: 'btn-mini', type: 'button', text: `${g.action_label || 'Open'} →`, onclick: go(g.destination) }) : null,
        ))), 'Open gaps'))
      : []),
    h('p', { class: 'muted', style: 'margin-top:8px', text: 'Counted by ATS Engine from your own records, with your desk\'s own minimum and priority points.' }),
    h('button', { class: 'link', type: 'button', text: 'Open the Intelligence Centre', onclick: () => open(to.professional()) }),
  );
}

/* A Standard desk asking for a Professional insight. */
function proOffer(message) {
  return h(
    'div',
    { class: 'card pro-card' },
    h('div', { class: 'pro-head' }, h('span', { class: 'pro-tag', text: 'PRO' }), h('h2', { text: 'Part of ATS Engine Professional' })),
    h('p', { text: message || 'This is part of ATS Engine Professional.' }),
    h('ul', { class: 'tips' },
      h('li', { text: 'Who in your pool fits this vacancy, and whether there are enough for a shortlist' }),
      h('li', { text: 'Must-haves nobody in your pool can show, before the client asks' }),
      h('li', { text: 'Strong matches nobody has approached yet' }),
      h('li', { text: 'The next step, with the reason it comes first' }),
    ),
    h('button', { class: 'btn gold', type: 'button', text: 'See ATS Engine Professional', onclick: () => open(to.team()) }),
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
  getConnection().then((c) => homeScreen(c, err.message));
}

// ---- start -----------------------------------------------------------------
async function start() {
  const connection = await getConnection();
  if (!connection?.token) return connectScreen();
  homeScreen(connection);
  // Confirm the connection is still good (and refresh the name shown).
  try {
    const me = await api.me();
    if (me.role && me.role !== 'recruiter') {
      return connectScreen('You are signed in with a job seeker account. This is the recruiter extension - use ATS Engine - Seekers instead, and you can remove this one.');
    }
    caps = Array.isArray(me.capabilities) ? me.capabilities : [];
    showWho({ ...connection, user: me.user });
    fillProSlot();
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

// Connected in another tab (the app's Connect page): show it here at once.
let lastToken;
getConnection().then((c) => { lastToken = c?.token || null; });
onConnectionChange((c) => {
  const token = c?.token || null;
  const fresh = token && token !== lastToken; // a new connection; a removed one already shows its own screen
  lastToken = token;
  if (fresh) start();
});
start();
