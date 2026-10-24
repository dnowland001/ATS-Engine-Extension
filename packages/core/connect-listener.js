/*
 * Finishing a connection (21 Oct 2026) - the whole background worker of
 * both extensions. The ATS Engine Connect page (open in a signed-in app
 * tab) sends a one-time code here; this swaps it for the extension's own
 * token and stores it. Only messages from the ATS Engine app's own
 * address are accepted - see externally_connectable in the manifest,
 * checked again here.
 */
import { createApi } from './api.js';
import { saveConnection, browserName, readVerifier, forgetVerifier, isFirefox } from './connection.js';

export function listenForConnect(config, runtime = chrome.runtime, storage = chrome.storage?.local) {
  const api = createApi({ baseUrl: config.apiBase, getToken: async () => '' });
  const appOrigin = new URL(config.appBase).origin;
  const fromApp = (url) => {
    try {
      return new URL(url).origin === appOrigin;
    } catch {
      return false;
    }
  };

  const firefox = isFirefox(runtime);
  const finish = (code, sendResponse) => {
    (async () => {
      // Firefox: the secret this extension opened Connect with. Kept until
      // it has worked, so a failed try can simply be pressed again.
      const verifier = firefox ? await readVerifier(storage) : null;
      if (firefox && !verifier) {
        throw new Error('Open Connect again from the ATS Engine button in your toolbar.');
      }
      const res = await api.exchange(code, browserName(), verifier, firefox ? runtime.id : null);
      await saveConnection({ token: res.token, role: res.role, expires_at: res.expires_at, user: res.user });
      if (firefox) await forgetVerifier(storage);
      sendResponse({ ok: true });
    })().catch((err) => sendResponse({ ok: false, message: err.message }));
    return true; // answering asynchronously
  };

  // Chrome and Edge: the Connect page messages the extension directly.
  runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ats-engine-connect') {
      return false;
    }
    if (!fromApp(sender.url) || typeof message.code !== 'string') {
      sendResponse({ ok: false, message: 'That did not come from ATS Engine.' });
      return false;
    }
    return finish(message.code, sendResponse);
  });

  // Firefox (24 Oct 2026): the page cannot message an extension, so the
  // extension's own small script on the Connect page (core/connect-bridge.js)
  // passes the code on. Only from that script, only on the ATS Engine app.
  runtime.onMessage?.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ats-engine-connect') {
      return false;
    }
    if (sender.id !== runtime.id || !fromApp(sender.url) || typeof message.code !== 'string') {
      sendResponse({ ok: false, message: 'That did not come from ATS Engine.' });
      return false;
    }
    return finish(message.code, sendResponse);
  });
}
