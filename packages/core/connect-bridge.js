/*
 * Firefox and Safari only (24 Oct 2026): the extension's script on the ATS Engine
 * Connect page. In Chrome and Edge the page messages the extension
 * directly; Firefox and Safari do not allow that, so the page posts the one-time
 * code to this script, which passes it to the extension and posts the
 * answer back. It is loaded on the app, acts only on its /extension/connect
 * page, and only answers messages meant for this extension's own ID.
 *
 * In Firefox the code is bound to the secret the extension opened this page
 * with (see connection.js connectLink), so a web page cannot use it. (An
 * add-on with script on the app could open its own Connect page - but it
 * could already read the app's login, so that gains it nothing.)
 *
 * A classic script, not a module - content scripts cannot be modules.
 */
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  // The name ATS Engine knows this build by - the build writes it in for
  // Safari, whose own extension ID is not under our control.
  const BUILT = '__CONNECT_ID__';
  const id = BUILT.startsWith('__') ? ext.runtime.id : BUILT;
  const onConnectPage = () => /^\/extension\/connect\/?$/.test(window.location.pathname);
  const post = (data) => window.postMessage({ source: 'ats-engine-extension', ext: id, ...data }, window.location.origin);

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const m = event.data;
    if (!m || m.source !== 'ats-engine-app' || !onConnectPage()) return;
    if (m.type === 'ats-engine-ping') {
      post({ type: 'ats-engine-hello' });
      return;
    }
    if (m.type !== 'ats-engine-connect' || m.ext !== id || typeof m.code !== 'string') return;
    Promise.resolve(ext.runtime.sendMessage({ type: 'ats-engine-connect', code: m.code })).then(
      (reply) => post({ type: 'ats-engine-connect-reply', ok: Boolean(reply?.ok), message: reply?.message || '' }),
      (err) => post({ type: 'ats-engine-connect-reply', ok: false, message: String(err?.message || err) }),
    );
  });

  if (onConnectPage()) post({ type: 'ats-engine-hello' });
})();
