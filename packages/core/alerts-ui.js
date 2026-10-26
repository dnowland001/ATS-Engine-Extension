/*
 * The panel's half of the alerts (26 Oct 2026): a banner above everything
 * else when a message or an email is waiting, with a button straight to it,
 * and the "Desktop alerts" switch in the footer. See alerts.js.
 */
import { h, fill } from './dom.js';
import { ALERTS_KEY, alertText, checkAlerts, desktopAllowed, pathFor, readAlerts, readPrefs, setDesktop } from './alerts.js';

export function mountAlerts({ api, appBase, getConnection, doc = document, c = chrome }) {
  const app = doc.getElementById('app');
  const host = h('div', { id: 'alerts', 'aria-live': 'polite' });
  app.before(host);
  const base = appBase.replace(/\/$/, '');

  const openPath = (path) => c.tabs.create({ url: `${base}${path}` });

  async function render() {
    const a = await readAlerts(c.storage.local);
    const text = alertText(a);
    if (!text) return fill(host);
    const latest = a.emails > 0 ? a.latest_emails?.[0] : null;
    fill(
      host,
      h('div', { class: 'alert-banner', 'data-testid': 'alert-banner' },
        h('div', { class: 'alert-banner-text' },
          h('span', { class: 'alert-bell', 'aria-hidden': 'true', text: '🔔' }),
          h('span', {}, h('strong', { text: `You have ${text}` }),
            latest ? h('span', { class: 'alert-latest', text: `${latest.from}: ${latest.subject}` }) : null)),
        h('div', { class: 'alert-banner-acts' },
          a.messages > 0
            ? h('button', { class: 'btn-mini', type: 'button', text: 'Open messages', onclick: () => openPath(pathFor('messages', a)) })
            : null,
          a.emails > 0
            ? h('button', {
                class: 'btn-mini', type: 'button', text: 'Open inbox',
                onclick: async () => {
                  openPath(pathFor('emails', a));
                  await api.alertsSeen().catch(() => {});
                  refresh();
                },
              })
            : null)),
    );
  }

  async function refresh() {
    await checkAlerts({ api, connected: Boolean((await getConnection())?.token), c });
    render();
  }

  // The footer switch for desktop alerts.
  const foot = doc.getElementById('foot');
  let toggle = null;
  async function label() {
    if (!toggle) return;
    const on = (await readPrefs(c.storage.local)).desktop && (await desktopAllowed(c));
    toggle.textContent = on ? 'Desktop alerts: on' : 'Desktop alerts: off';
    toggle.setAttribute('aria-pressed', String(on));
  }
  if (foot) {
    toggle = h('button', { class: 'link', id: 'alerts-desktop', type: 'button', title: 'A pop-up on your screen when a message or an email arrives' });
    toggle.addEventListener('click', async () => {
      const on = (await readPrefs(c.storage.local)).desktop && (await desktopAllowed(c));
      // Straight from the click: the browser asks for permission only on a user gesture.
      await setDesktop(!on, c);
      label();
    });
    foot.append(toggle);
    label();
  }

  c.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ALERTS_KEY]) render();
  });

  render();
  refresh();
  return { refresh, render };
}
