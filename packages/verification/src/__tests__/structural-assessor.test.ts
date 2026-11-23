import { describe, expect, it } from 'vitest';
import { assessStructural } from '../semantic/structural-assessor.js';

describe('assessStructural', () => {
  it('reports exact-preservation for byte-identical strings', () => {
    const result = assessStructural('hello world', 'hello world');
    expect(result.classification).toBe('exact-preservation');
    expect(result.confidence).toBe(100);
  });

  it('reports exact-preservation for canonically-equal JSON with different key order', () => {
    const result = assessStructural('{"a":1,"b":2}', '{"b":2,"a":1}');
    expect(result.classification).toBe('exact-preservation');
  });

  it('reports likely-equivalent for text differing only by case/punctuation/whitespace', () => {
    const result = assessStructural('Hello, World!', 'hello world');
    expect(result.classification).toBe('likely-equivalent');
    expect(result.confidence).toBeGreaterThanOrEqual(80);
  });

  it('reports likely-divergent for moderately different text', () => {
    const result = assessStructural(
      'the quick brown fox',
      'completely unrelated content about databases',
    );
    expect(['likely-divergent', 'divergent']).toContain(result.classification);
  });

  it('reports divergent for near-completely dissimilar text (similarity below 0.5)', () => {
    const result = assessStructural(
      'abc',
      'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    );
    expect(result.classification).toBe('divergent');
  });

  it('handles one empty and one non-empty string without throwing', () => {
    const result = assessStructural('', 'hello');
    expect(result.classification).toBe('divergent');
    expect(result.confidence).toBe(0);
  });

  it('never classifies non-identical natural language as exact-preservation', () => {
    const result = assessStructural(
      'The system must respond within 100ms.',
      'The system should respond quickly.',
    );
    expect(result.classification).not.toBe('exact-preservation');
  });

  it('always includes a method, methodVersion, and rationale for attribution', () => {
    const result = assessStructural('a', 'b');
    expect(result.method).toBe('structural-text-assessor');
    expect(result.methodVersion).toBeTruthy();
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it('handles empty strings without throwing', () => {
    const result = assessStructural('', '');
    expect(result.classification).toBe('exact-preservation');
  });

  it('does not call a negation flip likely-equivalent, however similar the characters are', () => {
    const result = assessStructural(
      'The system must not log personally identifiable information.',
      'The system must log personally identifiable information.',
    );
    expect(result.classification).not.toBe('likely-equivalent');
    expect(result.confidence).toBeLessThan(50);
    expect(result.rationale).toMatch(/negation/);
  });

  it('flags a weakened obligation and a changed number', () => {
    expect(
      assessStructural(
        'The service must respond within 200 ms.',
        'The service may respond within 200 ms.',
      ).classification,
    ).not.toBe('likely-equivalent');
    expect(
      assessStructural('Retry up to 3 times before failing.', 'Retry up to 8 times before failing.')
        .classification,
    ).not.toBe('likely-equivalent');
  });

  it('still reports a harmless rewording as likely-equivalent', () => {
    expect(
      assessStructural(
        'The system shall record every approval decision.',
        'The system shall record every approval decision!',
      ).classification,
    ).toBe('likely-equivalent');
  });
});
