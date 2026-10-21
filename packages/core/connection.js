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
  return 'Browser';
}

export function connectUrl(appBase, extensionId) {
  return `${appBase}/extension/connect?ext=${encodeURIComponent(extensionId)}`;
}
