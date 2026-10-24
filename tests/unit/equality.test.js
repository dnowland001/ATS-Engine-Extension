import { describe, it, expect } from 'vitest';
import { EQUALITY, cleanEquality, saveEquality, loadEquality, EQUALITY_KEY } from '../../packages/core/equality.js';

const memory = () => {
  const store = {};
  return { store, get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; } };
};

describe('equality monitoring answers', () => {
  it('every question offers "Prefer not to say"', () => {
    for (const q of EQUALITY) expect(q.options).toContain('Prefer not to say');
  });
  it('keeps only known questions and known options', () => {
    expect(cleanEquality({ gender: 'Woman', ethnicity: 'made up', other: 'x', age: '25-34' })).toEqual({ gender: 'Woman', age: '25-34' });
  });
  it('is saved in the browser, and clearing removes it', async () => {
    const s = memory();
    await saveEquality({ gender: 'Man', disability: 'No' }, s);
    expect(s.store[EQUALITY_KEY]).toEqual({ gender: 'Man', disability: 'No' });
    expect(await loadEquality(s)).toEqual({ gender: 'Man', disability: 'No' });
    await saveEquality({}, s);
    expect(s.store[EQUALITY_KEY]).toBeUndefined();
  });
});
