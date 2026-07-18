import { describe, expect, it } from 'vitest';
import { diffValues } from '../diff.js';

describe('diffValues', () => {
  it('returns no entries for deeply equal values', () => {
    expect(diffValues({ a: 1, b: [1, 2, { c: 3 }] }, { a: 1, b: [1, 2, { c: 3 }] })).toEqual([]);
  });

  it('reports a changed scalar at the root', () => {
    expect(diffValues('draft', 'final')).toEqual([
      { path: '$', type: 'changed', before: 'draft', after: 'final' },
    ]);
  });

  it('reports an added key', () => {
    expect(diffValues({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { path: '$.b', type: 'added', after: 2 },
    ]);
  });

  it('reports a removed key', () => {
    expect(diffValues({ a: 1, b: 2 }, { a: 1 })).toEqual([
      { path: '$.b', type: 'removed', before: 2 },
    ]);
  });

  it('reports a changed nested value with its full path', () => {
    expect(diffValues({ data: { title: 'old' } }, { data: { title: 'new' } })).toEqual([
      { path: '$.data.title', type: 'changed', before: 'old', after: 'new' },
    ]);
  });

  it('treats a whole array as changed when its contents differ, rather than diffing per-element', () => {
    const entries = diffValues({ tags: ['a', 'b'] }, { tags: ['a', 'c'] });
    expect(entries).toEqual([
      { path: '$.tags', type: 'changed', before: ['a', 'b'], after: ['a', 'c'] },
    ]);
  });

  it('reports multiple independent differences across sibling keys', () => {
    const entries = diffValues(
      { title: 'old', status: 'draft', extra: true },
      { title: 'new', status: 'draft' },
    );
    expect(entries).toEqual(
      expect.arrayContaining([
        { path: '$.title', type: 'changed', before: 'old', after: 'new' },
        { path: '$.extra', type: 'removed', before: true },
      ]),
    );
    expect(entries).toHaveLength(2);
  });
});
