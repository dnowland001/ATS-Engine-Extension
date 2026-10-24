import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from '../../scripts/build.mjs';
import { connectLink, challengeFor, readVerifier, forgetVerifier, isFirefox, VERIFIER_KEY, browserName } from '../../packages/core/connection.js';
import { listenForConnect } from '../../packages/core/connect-listener.js';

/* Firefox (24 Oct 2026): the same code, a Firefox manifest, and connecting with a secret. */

function memoryStorage() {
  const data = {};
  return {
    data,
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (o) => Object.assign(data, o),
    remove: async (k) => { delete data[k]; },
  };
}

const firefoxRuntime = { id: 'ats-engine-seekers@ats-engine.com', getURL: () => 'moz-extension://0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d/' };
const chromeRuntime = { id: 'fbpbkfikiogmljdnojhnhgfobinecgbm', getURL: () => 'chrome-extension://fbpbkfikiogmljdnojhnhgfobinecgbm/' };

describe('the Firefox build', () => {
  it('has a Firefox manifest and the connect bridge, and nothing Chrome-only', () => {
    const out = mkdtempSync(join(tmpdir(), 'ff-'));
    const { manifest } = build({ app: 'seeker', out, firefox: true });
    expect(manifest.key).toBeUndefined();
    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.side_panel).toBeUndefined();
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(manifest.browser_specific_settings.gecko.id).toBe('ats-engine-seekers@ats-engine.com');
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions.required).toEqual(['websiteContent']);
    expect(manifest.sidebar_action.default_panel).toBe('popup.html');
    expect(manifest.action.default_popup).toBe('popup.html'); // Firefox for Android has no sidebar
    expect(manifest.content_scripts).toEqual([{ matches: ['https://app.ats-engine.com/*'], js: ['core/connect-bridge.js'], run_at: 'document_idle' }]);
    expect(existsSync(join(out, 'core', 'connect-bridge.js'))).toBe(true);
  });

  it('the recruiter build keeps its pop-up and has its own ID', () => {
    const out = mkdtempSync(join(tmpdir(), 'ff-'));
    const { manifest } = build({ app: 'recruiter', out, firefox: true });
    expect(manifest.browser_specific_settings.gecko.id).toBe('recruiters@ats-engine.com');
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.sidebar_action).toBeUndefined();
  });

  it('Chrome and Edge builds never carry the bridge', () => {
    const out = mkdtempSync(join(tmpdir(), 'cr-'));
    const { manifest } = build({ app: 'seeker', out, store: true });
    expect(existsSync(join(out, 'core', 'connect-bridge.js'))).toBe(false);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.browser_specific_settings).toBeUndefined();
  });
});

describe('connecting in Firefox', () => {
  it('opens Connect with the challenge of a secret it keeps, and uses the secret once', async () => {
    const s = memoryStorage();
    const url = new URL(await connectLink('https://app.ats-engine.com', firefoxRuntime, s));
    expect(url.searchParams.get('ext')).toBe('ats-engine-seekers@ats-engine.com');
    const { verifier } = s.data[VERIFIER_KEY];
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(url.searchParams.get('challenge')).toBe(expected);
    expect(await challengeFor(verifier)).toBe(expected);
    expect(await readVerifier(s)).toBe(verifier);
    expect(await readVerifier(s)).toBe(verifier); // kept until it has worked
    await forgetVerifier(s);
    expect(await readVerifier(s)).toBeNull();
  });

  it('Chrome and Edge are unchanged', async () => {
    const s = memoryStorage();
    expect(isFirefox(chromeRuntime)).toBe(false);
    expect(await connectLink('https://app.ats-engine.com', chromeRuntime, s)).toBe('https://app.ats-engine.com/extension/connect?ext=fbpbkfikiogmljdnojhnhgfobinecgbm');
    expect(s.data).toEqual({});
    expect(browserName({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' })).toBe('Mozilla Firefox');
  });

  it('takes a code only from its own script on the ATS Engine app, and sends the secret with it', async () => {
    const s = memoryStorage();
    await s.set({ [VERIFIER_KEY]: { verifier: 'v'.repeat(50), made: Date.now() } });
    const listeners = {};
    const runtime = {
      id: 'ats-engine-seekers@ats-engine.com',
      getURL: () => 'moz-extension://0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d/',
      onMessage: { addListener: (fn) => { listeners.internal = fn; } },
    };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: 't', role: 'seeker', expires_at: '2099-01-01T00:00:00Z', user: { name: 'Amy' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', { storage: { local: s } });
    listenForConnect({ apiBase: 'https://api.ats-engine.com/api/v1', appBase: 'https://app.ats-engine.com' }, runtime, s);

    const refused = vi.fn();
    expect(listeners.internal({ type: 'ats-engine-connect', code: 'c' }, { id: 'someone-else@example.com', url: 'https://app.ats-engine.com/extension/connect' }, refused)).toBe(false);
    expect(refused).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    listeners.internal({ type: 'ats-engine-connect', code: 'c' }, { id: runtime.id, url: 'https://evil.example.com/' }, refused);
    expect(fetchMock).not.toHaveBeenCalled();

    const done = await new Promise((resolve) => {
      listeners.internal({ type: 'ats-engine-connect', code: 'c'.repeat(48) }, { id: runtime.id, url: 'https://app.ats-engine.com/extension/connect?ext=x' }, resolve);
    });
    expect(done).toEqual({ ok: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ code: 'c'.repeat(48), verifier: 'v'.repeat(50), ext: 'ats-engine-seekers@ats-engine.com' });
    expect(s.data[VERIFIER_KEY]).toBeUndefined(); // used, so forgotten

    // No secret any more: told to open Connect again, nothing sent.
    const again = await new Promise((resolve) => {
      listeners.internal({ type: 'ats-engine-connect', code: 'd'.repeat(48) }, { id: runtime.id, url: 'https://app.ats-engine.com/extension/connect' }, resolve);
    });
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/Open Connect again/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('the bridge script is plain JavaScript a content script can run', () => {
    const src = readFileSync(join(import.meta.dirname, '../../packages/core/connect-bridge.js'), 'utf8');
    expect(src).not.toMatch(/^\s*(import|export)\s/m);
    expect(src).toContain('onConnectPage');
    expect(src).not.toContain("startsWith('/extension/connect')");
  });
});
