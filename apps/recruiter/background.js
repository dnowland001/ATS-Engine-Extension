/* ATS Engine - Recruiters - background service worker: finishes connecting, and keeps the alerts badge up to date. */
import { CONFIG } from './core/config.js';
import { listenForConnect } from './core/connect-listener.js';
import { createApi } from './core/api.js';
import { getConnection, clearConnection } from './core/connection.js';
import { startAlerts } from './core/alerts.js';

listenForConnect(CONFIG);

// Alerts (26 Oct 2026): a red number on the icon for unread messages and new
// inbox emails, checked every couple of minutes; desktop alerts if turned on.
startAlerts({
  api: createApi({ baseUrl: CONFIG.apiBase, getToken: async () => (await getConnection())?.token || '', onUnauthorised: () => clearConnection() }),
  appBase: CONFIG.appBase,
  getConnection,
});
