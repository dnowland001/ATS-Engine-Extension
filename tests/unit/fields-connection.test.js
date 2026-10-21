import { describe, it, expect } from 'vitest';
import { cleanFields, missingRequired, VACANCY_FIELDS } from '../../packages/core/fields.js';
import { getConnection, saveConnection, clearConnection, connectUrl, browserName } from '../../packages/core/connection.js';
import { links } from '../../packages/core/links.js';

function memoryStorage() {
  const data = {};
  return {
    data,
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (o) => Object.assign(data, o),
    remove: async (k) => delete data[k],
  };
}

describe('fields', () => {
  it('trims, drops empty fields and never invents any', () => {
    expect(cleanFields({ title: '  Nurse ', company: '', salary: '   ', other: 'x', source_url: 'https://a' })).toEqual({
      title: 'Nurse',
      source_url: 'https://a',
    });
  });

  it('names the required fields still empty', () => {
    expect(missingRequired({ title: 'Nurse' })).toEqual(['Employer', 'Job description']);
    expect(missingRequired({ title: 'a', company: 'b', description: 'c' })).toEqual([]);
  });

  it('requires title, employer and description only', () => {
    expect(VACANCY_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(['title', 'company', 'description']);
  });
});

describe('connection', () => {
  it('saves, reads and clears', async () => {
    const s = memoryStorage();
    await saveConnection({ token: 't', expires_at: new Date(Date.now() + 60000).toISOString() }, s);
    expect((await getConnection(s)).token).toBe('t');
    await clearConnection(s);
    expect(await getConnection(s)).toBeNull();
  });

  it('forgets an expired connection', async () => {
    const s = memoryStorage();
    await saveConnection({ token: 't', expires_at: new Date(Date.now() - 1000).toISOString() }, s);
    expect(await getConnection(s)).toBeNull();
    expect(s.data).toEqual({});
  });

  it('builds the connect link', () => {
    expect(connectUrl('https://app.ats-engine.com', 'abcdefghijklmnopabcdefghijklmnop')).toBe(
      'https://app.ats-engine.com/extension/connect?ext=abcdefghijklmnopabcdefghijklmnop',
    );
  });

  it('names the browser', () => {
    expect(browserName({ userAgentData: { brands: [{ brand: 'Microsoft Edge' }] } })).toBe('Microsoft Edge');
    expect(browserName({ userAgent: 'Mozilla/5.0 Chrome/130.0' })).toBe('Google Chrome');
  });
});

describe('links', () => {
  it('deep-links into the app screens', () => {
    const to = links('https://app.ats-engine.com');
    expect(to.vacancy(42)).toBe('https://app.ats-engine.com/jobs?open=42');
    expect(to.advertHealth(42)).toBe('https://app.ats-engine.com/tools?tab=ad&posting=42');
  });
});
