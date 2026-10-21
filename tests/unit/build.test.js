import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../scripts/build.mjs';

/** Fixed by the manifest key. ATS Engine's EXTENSION_ALLOWED_ORIGINS lists chrome-extension://<this>. */
const RECRUITER_ID = 'fmgfdjfhhjdkciahjdlgiefgelffglml';
const SEEKER_ID = 'fbpbkfikiogmljdnojhnhgfobinecgbm';

describe('build', () => {
  it('asks for the least the extension needs', () => {
    const out = mkdtempSync(join(tmpdir(), 'ext-'));
    const { manifest } = build({ out });
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest.host_permissions).toEqual(['https://api.ats-engine.com/*']);
    expect(manifest.externally_connectable.matches).toEqual(['https://app.ats-engine.com/*']);
    expect(manifest.content_scripts).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|tabs"|cookies|history|webRequest/);
  });

  it('writes the production addresses into config', () => {
    const out = mkdtempSync(join(tmpdir(), 'ext-'));
    build({ out });
    const cfg = readFileSync(join(out, 'core', 'config.js'), 'utf8');
    expect(cfg).toContain('https://api.ats-engine.com/api/v1');
    expect(cfg).toContain('https://app.ats-engine.com');
    for (const f of ['popup.html', 'popup.js', 'background.js', 'logo.png', 'icons/icon-128.png', 'core/api.js']) {
      expect(existsSync(join(out, f))).toBe(true);
    }
  });

  it('always has the same ID, in Chrome and Edge', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ext-'));
    const { manifest } = build({ out });
    const { createHash } = await import('node:crypto');
    const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    expect(id).toBe(RECRUITER_ID);
  });

  it('the job seeker extension has its own fixed ID and the same small permissions', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ext-'));
    const { manifest } = build({ app: 'seeker', out });
    expect(manifest.name).toBe('ATS Engine - Seekers');
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest.content_scripts).toBeUndefined();
    const { createHash } = await import('node:crypto');
    const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
    expect([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')).toBe(SEEKER_ID);
    expect(existsSync(join(out, 'core', 'match.js'))).toBe(true);
  });

  it('never writes page data into the seeker popup as HTML', () => {
    const popup = readFileSync(new URL('../../apps/seeker/popup.js', import.meta.url), 'utf8');
    expect(popup).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it('gives each extension its own icon', async () => {
    const a = mkdtempSync(join(tmpdir(), 'ext-'));
    const b = mkdtempSync(join(tmpdir(), 'ext-'));
    build({ app: 'recruiter', out: a });
    build({ app: 'seeker', out: b });
    const { createHash } = await import('node:crypto');
    const sum = (d) => createHash('md5').update(readFileSync(join(d, 'icons', 'icon-128.png'))).digest('hex');
    expect(sum(a)).toBe(createHash('md5').update(readFileSync(new URL('../../assets/recruiter-icon-128.png', import.meta.url))).digest('hex'));
    expect(sum(b)).toBe(createHash('md5').update(readFileSync(new URL('../../assets/seeker-icon-128.png', import.meta.url))).digest('hex'));
  });

  it('the store build leaves out the key, and nothing else', () => {
    const a = mkdtempSync(join(tmpdir(), 'ext-'));
    const b = mkdtempSync(join(tmpdir(), 'ext-'));
    const { manifest: download } = build({ app: 'seeker', out: a });
    const { manifest: store } = build({ app: 'seeker', out: b, store: true });
    expect(download.key).toBeTruthy();
    expect(store.key).toBeUndefined();
    const { key, ...rest } = download;
    expect(store).toEqual(rest);
  });

  it('marks a local build in its name', () => {
    const out = mkdtempSync(join(tmpdir(), 'ext-'));
    const { manifest } = build({ out, env: 'local' });
    expect(manifest.name).toBe('ATS Engine - Recruiters (local)');
    expect(manifest.host_permissions).toEqual(['http://localhost:8000/*']);
  });

  it('never writes page data into the popup as HTML', () => {
    const popup = readFileSync(new URL('../../apps/recruiter/popup.js', import.meta.url), 'utf8');
    expect(popup).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
