/*
 * Finishing a connection (21 Oct 2026) - the whole background worker of
 * both extensions. The ATS Engine Connect page (open in a signed-in app
 * tab) sends a one-time code here; this swaps it for the extension's own
 * token and stores it. Only messages from the ATS Engine app's own
 * address are accepted - see externally_connectable in the manifest,
 * checked again here.
 */
import { createApi } from './api.js';
import { saveConnection, browserName } from './connection.js';

export function listenForConnect(config, runtime = chrome.runtime) {
  const api = createApi({ baseUrl: config.apiBase, getToken: async () => '' });

  runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'ats-engine-connect') {
      return false;
    }
    let fromApp = false;
    try {
      fromApp = new URL(sender.url).origin === new URL(config.appBase).origin;
    } catch {
      fromApp = false;
    }
    if (!fromApp || typeof message.code !== 'string') {
      sendResponse({ ok: false, message: 'That did not come from ATS Engine.' });
      return false;
    }

    api
      .exchange(message.code, browserName())
      .then(async (res) => {
        await saveConnection({ token: res.token, role: res.role, expires_at: res.expires_at, user: res.user });
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, message: err.message }));

    return true; // answering asynchronously
  });
}
