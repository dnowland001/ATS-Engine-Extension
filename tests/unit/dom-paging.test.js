import { describe, it, expect } from 'vitest';
import { pageSlice } from '../../packages/core/dom.js';

describe('pageSlice', () => {
  const seven = [1, 2, 3, 4, 5, 6, 7];
  it('cuts a list into pages and says where it is', () => {
    expect(pageSlice(seven, 1, 3)).toMatchObject({ items: [1, 2, 3], page: 1, pages: 3, from: 1, to: 3, total: 7 });
    expect(pageSlice(seven, 3, 3)).toMatchObject({ items: [7], from: 7, to: 7 });
  });
  it('keeps the page in range, and an empty list is one empty page', () => {
    expect(pageSlice(seven, 9, 3).page).toBe(3);
    expect(pageSlice(seven, 0, 3).page).toBe(1);
    expect(pageSlice([], 1, 3)).toMatchObject({ items: [], pages: 1, from: 0, total: 0 });
  });
});
