import { describe, it, expect, vi } from 'vitest';
import { alertText, badgeFor, whatIsNew, checkAlerts, setDesktop, pathFor, ALERTS_KEY, PREFS_KEY } from '../../packages/core/alerts.js';

function fakeChrome({ granted = false, allow = true } = {}) {
  const store = {};
  return {
    store,
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (o) => Object.assign(store, o),
        remove: async (k) => { delete store[k]; },
      },
    },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) },
    permissions: {
      contains: vi.fn(async () => granted),
      request: vi.fn(async () => { granted = allow; return allow; }),
    },
    notifications: { create: vi.fn() },
  };
}
const answer = (messages, emails, latest = []) => ({ messages, emails, total: messages + emails, latest_emails: latest, paths: { messages: '/communications', emails: '/emails' } });

describe('alerts', () => {
  it('says what is waiting in plain words, and caps the badge', () => {
    expect(alertText({ messages: 2, emails: 1 })).toBe('2 new messages and 1 new email');
    expect(alertText({ messages: 0, emails: 3 })).toBe('3 new emails');
    expect(alertText({ messages: 0, emails: 0 })).toBe('');
    expect(badgeFor(0)).toBe('');
    expect(badgeFor(7)).toBe('7');
    expect(badgeFor(140)).toBe('99+');
  });

  it('only counts what went up, and nothing on the first look', () => {
    expect(whatIsNew(null, { messages: 3, emails: 1 })).toBeNull();
    expect(whatIsNew({ messages: 1, emails: 1 }, { messages: 3, emails: 1 })).toEqual({ messages: 2, emails: 0 });
    expect(whatIsNew({ messages: 3, emails: 1 }, { messages: 0, emails: 1 })).toBeNull();
  });

  it('puts the total on the icon, and clears it when signed out', async () => {
    const c = fakeChrome();
    const api = { alerts: vi.fn(async () => answer(2, 1)) };
    await checkAlerts({ api, connected: true, c });
    expect(c.action.setBadgeText).toHaveBeenLastCalledWith({ text: '3' });
    expect(c.store[ALERTS_KEY].messages).toBe(2);
    await checkAlerts({ api, connected: false, c });
    expect(c.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(c.store[ALERTS_KEY]).toBeUndefined();
  });

  it('clears the badge when the plan no longer has the extension', async () => {
    const c = fakeChrome();
    await checkAlerts({ api: { alerts: async () => answer(1, 0) }, connected: true, c });
    const err = Object.assign(new Error('plan'), { status: 402 });
    await checkAlerts({ api: { alerts: async () => { throw err; } }, connected: true, c });
    expect(c.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('a desktop alert only when turned on, allowed, and something is new', async () => {
    const c = fakeChrome();
    let n = answer(1, 0);
    const api = { alerts: async () => n };
    await checkAlerts({ api, connected: true, c }); // first look
    n = answer(2, 1, [{ from: 'Jane Smith', subject: 'Interview on Tuesday' }]);
    await checkAlerts({ api, connected: true, c });
    expect(c.notifications.create).not.toHaveBeenCalled(); // not turned on

    expect(await setDesktop(true, c)).toBe(true);
    expect(c.store[PREFS_KEY]).toEqual({ desktop: true });
    n = answer(3, 2, [{ from: 'Jane Smith', subject: 'Offer letter' }]);
    await checkAlerts({ api, connected: true, c });
    expect(c.notifications.create).toHaveBeenCalledTimes(1);
    const [id, opts] = c.notifications.create.mock.calls[0];
    expect(id).toMatch(/^ats-engine-messages-/);
    expect(opts.message).toBe('1 new message and 1 new email\nJane Smith: Offer letter');

    await checkAlerts({ api, connected: true, c }); // nothing new
    expect(c.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('turning desktop alerts on stays off when the browser says no', async () => {
    const c = fakeChrome({ allow: false });
    expect(await setDesktop(true, c)).toBe(false);
    expect(c.store[PREFS_KEY]).toEqual({ desktop: false });
  });

  it('knows where each kind of alert opens', () => {
    expect(pathFor('emails', null)).toBe('/emails');
    expect(pathFor('messages', { paths: { messages: '/communications', emails: '/emails' } })).toBe('/communications');
  });
});
