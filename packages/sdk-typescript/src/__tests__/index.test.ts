import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';

describe('package entrypoint', () => {
  it('re-exports the public API', () => {
    expect(typeof sdk.buildUnsignedEvent).toBe('function');
    expect(typeof sdk.newArtifactId).toBe('function');
    expect(typeof sdk.ActClient).toBe('function');
    expect(typeof sdk.ActApiError).toBe('function');
  });
});
