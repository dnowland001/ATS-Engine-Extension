/* ATS Engine for Recruiters - background service worker: finishes connecting, nothing else. */
import { CONFIG } from './core/config.js';
import { listenForConnect } from './core/connect-listener.js';

listenForConnect(CONFIG);
