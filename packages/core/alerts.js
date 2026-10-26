/*
 * Alerts (26 Oct 2026): a message or an email waiting in ATS Engine, for
 * somebody working in the browser rather than the app. Shared by both
 * extensions.
 *
 * Three ways it shows, least to most intrusive:
 *   1. A red number on the toolbar icon - checked in the background every
 *      couple of minutes (chrome.alarms; no permission warning).
 *   2. A banner at the top of the panel, with a button straight to it.
 *   3. A desktop notification - OPT-IN, with the optional "notifications"
 *      permission asked for only when the person turns it on. A new
 *      required permission would switch the extension off for everybody
 *      until they re-approved it; an optional one switches off nobody.
 *
 * The counts come from GET /extension/alerts: the app's own unread
 * messages, and inbox emails since the person last looked.
 */

export const ALERTS_KEY = 'atsEngineAlerts';
export const PREFS_KEY = 'atsEngineAlertPrefs';
export const ALARM = 'ats-engine-alerts';
export const PERIOD_MINUTES = 2;
const NOTIFY_PERMISSION = { permissions: ['notifications'] };

/** "2 new messages and 1 new email", or '' when there is nothing. */
export function alertText(a) {
  if (!a) return '';
  const parts = [];
  if (a.messages > 0) parts.push(`${a.messages} new message${a.messages === 1 ? '' : 's'}`);
  if (a.emails > 0) parts.push(`${a.emails} new email${a.emails === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

export function badgeFor(total) {
  if (!total || total < 1) return '';
  return total > 99 ? '99+' : String(total);
}

export async function readAlerts(storage = chrome.storage.local) {
  return (await storage.get(ALERTS_KEY))[ALERTS_KEY] || null;
}

export async function readPrefs(storage = chrome.storage.local) {
  return { desktop: false, ...((await storage.get(PREFS_KEY))[PREFS_KEY] || {}) };
}

export async function desktopAllowed(c = chrome) {
  try {
    return Boolean(await c.permissions.contains(NOTIFY_PERMISSION));
  } catch {
    return false;
  }
}

/**
 * Turn desktop alerts on or off. Turning on asks the browser for the
 * notifications permission, so it has to be called straight from a click.
 */
export async function setDesktop(on, c = chrome) {
  let allowed = false;
  if (on) {
    try {
      allowed = Boolean(await c.permissions.request(NOTIFY_PERMISSION));
    } catch {
      allowed = false;
    }
  }
  const prefs = { desktop: on && allowed };
  await c.storage.local.set({ [PREFS_KEY]: prefs });
  return prefs.desktop;
}

async function setBadge(total, c) {
  try {
    await c.action.setBadgeBackgroundColor?.({ color: '#dc2626' });
    await c.action.setBadgeText({ text: badgeFor(total) });
    await c.action.setTitle?.({ title: total > 0 ? `ATS Engine - ${total} waiting for you` : '' });
  } catch {
    // A browser without badges (Safari on iPhone) - the panel banner still says it.
  }
}

/** Which counts went up since last time: those are worth telling somebody about. */
export function whatIsNew(before, now) {
  if (!before) return null; // first look after connecting: show the badge, do not pop up
  const messages = Math.max(0, (now.messages || 0) - (before.messages || 0));
  const emails = Math.max(0, (now.emails || 0) - (before.emails || 0));
  return messages || emails ? { messages, emails } : null;
}

/**
 * Ask ATS Engine what is waiting, store it, update the badge, and pop up a
 * desktop notification for anything new when the person has turned that on.
 * Signed out, on a plan without the extension, or offline: the badge clears
 * and nothing is said.
 */
export async function checkAlerts({ api, connected, c = chrome, now = () => Date.now() }) {
  if (!connected) {
    await c.storage.local.remove(ALERTS_KEY);
    await setBadge(0, c);
    return null;
  }

  let fresh;
  try {
    fresh = await api.alerts();
  } catch (err) {
    if (err?.status === 401 || err?.status === 402 || err?.status === 403) {
      await c.storage.local.remove(ALERTS_KEY);
      await setBadge(0, c);
    }
    return null;
  }

  const before = await readAlerts(c.storage.local);
  const alerts = {
    messages: Number(fresh.messages) || 0,
    emails: Number(fresh.emails) || 0,
    total: Number(fresh.total) || 0,
    latest_emails: fresh.latest_emails || [],
    paths: fresh.paths || { messages: '/communications', emails: '/emails' },
    checked_at: now(),
  };
  await c.storage.local.set({ [ALERTS_KEY]: alerts });
  await setBadge(alerts.total, c);

  const news = whatIsNew(before, alerts);
  if (news && (await readPrefs(c.storage.local)).desktop && (await desktopAllowed(c)) && c.notifications) {
    const latest = alerts.latest_emails[0];
    const lines = [alertText(news)];
    if (news.emails && latest) lines.push(`${latest.from}: ${latest.subject}`);
    try {
      c.notifications.create(`ats-engine-${news.messages ? 'messages' : 'emails'}-${now()}`, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'ATS Engine',
        message: lines.join('\n'),
        priority: 1,
      });
    } catch {
      // Notifications blocked at the system level - the badge still shows.
    }
  }

  return alerts;
}

/** Where a click on a notification or a banner button should go. */
export function pathFor(kind, alerts) {
  const paths = alerts?.paths || { messages: '/communications', emails: '/emails' };
  return kind === 'emails' ? paths.emails : paths.messages;
}

/**
 * The background half: an alarm every couple of minutes, a check when the
 * browser starts or the connection changes, and notification clicks that
 * open the right page of the app.
 */
export function startAlerts({ api, appBase, getConnection, c = chrome }) {
  const run = async () => checkAlerts({ api, connected: Boolean((await getConnection())?.token), c });

  try {
    c.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: 0.1 });
    c.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === ALARM) run();
    });
  } catch {
    // No alarms (should not happen on a supported browser): the panel still checks when opened.
  }
  c.runtime.onStartup?.addListener(run);
  c.runtime.onInstalled?.addListener(run);
  c.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.atsEngineConnection) run();
  });
  c.runtime.onMessage?.addListener((msg) => {
    if (msg?.type === 'ats-alerts-check') run();
  });
  c.notifications?.onClicked?.addListener(async (id) => {
    if (!String(id).startsWith('ats-engine-')) return;
    const kind = String(id).includes('-emails-') ? 'emails' : 'messages';
    const alerts = await readAlerts(c.storage.local);
    if (kind === 'emails') await api.alertsSeen().catch(() => {});
    c.tabs.create({ url: `${appBase.replace(/\/$/, '')}${pathFor(kind, alerts)}` });
    c.notifications.clear(id);
    run();
  });

  return run;
}
