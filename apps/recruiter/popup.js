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
import { links } from './core/links.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const foot = document.getElementById('foot');
const to = links(CONFIG.appBase);

const api = createApi({
  baseUrl: CONFIG.apiBase,
  getToken: async () => (await getConnection())?.token || '',
  onUnauthorised: () => clearConnection(),
});

// ---- tiny DOM helper: text only, never HTML --------------------------------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function show(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
}

function open(url) {
  chrome.tabs.create({ url });
}

function notice(kind, text) {
  return h('div', { class: `notice ${kind}`, role: kind === 'bad' ? 'alert' : undefined, text });
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
  const inputs = {};

  const fieldNodes = VACANCY_FIELDS.map((f) => {
    const id = `f-${f.key}`;
    const control = f.multiline
      ? h('textarea', { id, placeholder: 'Not found on the page - add it if you know it' })
      : h('input', { id, type: 'text', placeholder: 'Not found on the page' });
    control.value = values[f.key] || '';
    inputs[f.key] = control;
    return h('div', {}, h('label', { for: id }, f.label, f.required ? h('span', { class: 'req', text: ' *' }) : null), control);
  });

  const read = () => {
    const v = { source_url: values.source_url };
    for (const [k, el] of Object.entries(inputs)) v[k] = el.value;
    return v;
  };

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
  show(
    h(
      'div',
      { class: 'card' },
      h('h1', { text: title }),
      h('p', {}, h('strong', { text: job?.title || '' }), job?.location ? ` · ${job.location}` : '', job?.salary ? ` · ${job.salary}` : ''),
      how === 'unchanged' ? h('p', { class: 'muted', text: 'Everything on the page was already on the vacancy.' }) : null,
      id ? h('button', { class: 'btn', type: 'button', text: 'Open in ATS Engine', onclick: () => open(to.vacancy(id)) }) : null,
      id ? h('button', { class: 'btn secondary', type: 'button', text: 'Run Advert Health', onclick: () => open(to.advertHealth(id)) }) : null,
      h('button', { class: 'btn secondary', type: 'button', text: 'Capture another job', onclick: start }),
    ),
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
