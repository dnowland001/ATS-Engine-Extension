/*
 * ATS Engine - Seekers - background service worker: finishes connecting,
 * and (0.4.1, 23 Oct 2026) opens the extension as a side panel rather
 * than a popup. Dennis: a popup closes the moment you click the job page,
 * taking the check with it - so you could not copy into the form, or come
 * back to mark it applied. The side panel stays open beside the page.
 */
import { CONFIG } from './core/config.js';
import { listenForConnect } from './core/connect-listener.js';

listenForConnect(CONFIG);

chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
