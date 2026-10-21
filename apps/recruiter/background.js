/*
 * ATS Engine for Recruiters - background service worker (21 Oct 2026).
 *
 * One job: finish connecting. The ATS Engine Connect page (open in a
 * signed-in app tab) sends a one-time code here; this swaps it for the
 * extension's own token and stores it. Only messages from the ATS Engine
 * app's own address are accepted - see externally_connectable in the
 * manifest, checked again below.
 */
import { CONFIG } from './core/config.js';
import { createApi } from './core/api.js';
import { saveConnection, browserName } from './core/connection.js';

const api = createApi({ baseUrl: CONFIG.apiBase, getToken: async () => '' });

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ats-engine-connect') {
    return false;
  }
  let fromApp = false;
  try {
    fromApp = new URL(sender.url).origin === new URL(CONFIG.appBase).origin;
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
