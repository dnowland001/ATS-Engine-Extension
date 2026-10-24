/*
 * Where the extension keeps its connection (21 Oct 2026).
 *
 * Only the extension's own token, who it belongs to and when it expires.
 * No candidate data, no vacancies, no page content is ever stored. The
 * token can only reach the extension's few ATS Engine routes, expires
 * after 30 days, and is disconnected from ATS Engine Settings.
 */
const KEY = 'atsEngineConnection';

export async function getConnection(storage = chrome.storage.local) {
  const got = await storage.get(KEY);
  const c = got?.[KEY] || null;
  if (c && c.expires_at && Date.parse(c.expires_at) <= Date.now()) {
    await storage.remove(KEY);
    return null;
  }
  return c;
}

export async function saveConnection(connection, storage = chrome.storage.local) {
  await storage.set({ [KEY]: connection });
}

export async function clearConnection(storage = chrome.storage.local) {
  await storage.remove(KEY);
}

export function browserName(nav = globalThis.navigator) {
  const brands = (nav?.userAgentData?.brands || []).map((b) => b.brand);
  if (brands.includes('Microsoft Edge')) return 'Microsoft Edge';
  if (brands.includes('Google Chrome')) return 'Google Chrome';
  if (/Edg\//.test(nav?.userAgent || '')) return 'Microsoft Edge';
  if (/Chrome\//.test(nav?.userAgent || '')) return 'Google Chrome';
  if (/Firefox\//.test(nav?.userAgent || '')) return 'Mozilla Firefox';
  return 'Browser';
}

export function connectUrl(appBase, extensionId, challenge = '') {
  return `${appBase}/extension/connect?ext=${encodeURIComponent(extensionId)}${challenge ? `&challenge=${encodeURIComponent(challenge)}` : ''}`;
}

/*
 * Firefox (24 Oct 2026). Firefox gives every install a random
 * moz-extension:// address, so ATS Engine cannot recognise the extension
 * by its ID the way it does in Chrome and Edge. Instead the extension
 * makes a one-time secret, keeps it here, and opens the Connect page with
 * only its sha256 (the "challenge"). The code the page hands over is bound
 * to that, so only this extension - holding the secret - can use it.
 */
export const VERIFIER_KEY = 'atsEngineConnectVerifier';

export function isFirefox(runtime = chrome.runtime) {
  try {
    return String(runtime.getURL('')).startsWith('moz-extension:');
  } catch {
    return false;
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function makeVerifier(cryptoApi = globalThis.crypto) {
  return b64url(cryptoApi.getRandomValues(new Uint8Array(48)));
}

export async function challengeFor(verifier, cryptoApi = globalThis.crypto) {
  return b64url(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/** The Connect page's address - in Firefox with a fresh secret's challenge. */
export async function connectLink(appBase, runtime = chrome.runtime, storage = chrome.storage.local) {
  if (!isFirefox(runtime)) return connectUrl(appBase, runtime.id);
  const verifier = makeVerifier();
  await storage.set({ [VERIFIER_KEY]: { verifier, made: Date.now() } });
  return connectUrl(appBase, runtime.id, await challengeFor(verifier));
}

/** The secret for finishing a Firefox connect (null in Chrome and Edge, or when stale). */
export async function readVerifier(storage = chrome.storage.local) {
  try {
    const got = (await storage.get(VERIFIER_KEY))?.[VERIFIER_KEY];
    // Codes last five minutes; a secret much older than that is stale.
    return got?.verifier && Date.now() - (got.made || 0) < 30 * 60 * 1000 ? got.verifier : null;
  } catch {
    return null;
  }
}

/** Forget the secret - only once it has been used to connect. */
export async function forgetVerifier(storage = chrome.storage.local) {
  try {
    await storage.remove(VERIFIER_KEY);
  } catch {
    // nothing kept, nothing to forget
  }
}
