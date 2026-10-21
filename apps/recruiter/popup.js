/*
 * ATS Engine for Recruiters - the popup (Phase 1, 21 Oct 2026).
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
import { getConnection, clearConnection, connectUrl } from './core/connection.js';
import { readPage } from './core/page-reader.js';
import { VACANCY_FIELDS, DUPLICATE_REASONS, cleanFields, missingRequired } from './core/fields.js';
import { h, notice, fill } from './core/dom.js';
import { reviewForm } from './core/review-form.js';
import { links } from './core/links.js';
import { advertChecks, advertImprovements, matchSummary, CHECK_STATUS } from './core/intelligence.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const foot = document.getElementById('foot');
const to = links(CONFIG.appBase);

const api = createApi({
  baseUrl: CONFIG.apiBase,
  getToken: async () => (await getConnection())?.token || '',
  onUnauthorised: () => clearConnection(),
});

function show(...nodes) {
  fill(app, ...nodes);
}

function open(url) {
  chrome.tabs.create({ url });
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
      h('h1', { text: 'Capture jobs straight into ATS Engine' }),
      h('p', { class: 'muted', text: 'See a vacancy anywhere on the web, click once, review it, and it is in your ATS Engine desk.' }),
      h('button', {
        class: 'btn',
        type: 'button',
        text: 'Connect to ATS Engine',
        onclick: () => open(connectUrl(CONFIG.appBase, chrome.runtime.id)),
      }),
      h('p', { class: 'muted', style: 'margin-top:10px', text: 'Opens ATS Engine in a new tab. Sign in there if asked, press Connect, then come back here.' }),
      h('p', { class: 'for', text: 'For recruiter accounts. Looking for a job? Use ATS Engine for Job Seekers instead.' }),
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
  );
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
              h('button', { class: 'link', type: 'button', text: 'View existing', onclick: () => open(to.vacancy(e.id)) }),
              h('button', { class: 'link', type: 'button', text: 'Update this one', onclick: () => submit('fill', e.id) }),
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
    h('button', { class: 'link', type: 'button', text: 'Open Advert Health in ATS Engine', onclick: () => open(to.advertHealth(jobId)) }),
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

function handleError(err) {
  if (err.status === 401) return connectScreen(err.message);
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
      return connectScreen('You are signed in with a job seeker account. This is the recruiter extension - use ATS Engine for Job Seekers instead, and you can remove this one.');
    }
    showWho({ ...connection, user: me.user });
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
