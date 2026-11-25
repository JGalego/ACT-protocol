# ADR 0002: Hand-Rolled RFC 8785 Canonicalization Instead of a Dependency

## Status

Accepted

## Context

ACT's content-addressed identifiers (event ids, artifact-version ids, receipt digests) depend entirely on RFC 8785 (JSON Canonicalization Scheme) producing byte-identical output for equal values. We initially depended on the `canonicalize` npm package. Under this repository's `NodeNext` module resolution plus `esModuleInterop`, that package's CommonJS-with-ESM-shaped-`.d.ts` default export bound incorrectly at the type level (TypeScript resolved the import to the module namespace object rather than the exported function), and the same interop friction recurred with `ajv-formats`.

## Decision

`packages/core/src/canonical.ts` implements RFC 8785 for the strict JSON data model (object/array/string/number/boolean/null). It recursively sorts object keys by UTF-16 code unit and uses `JSON.stringify` for keys and leaf values, preserving JCS number formatting (ECMA-262 `Number::toString`) and string escaping. Tests include a JCS Unicode-escaping vector.

Similarly, `packages/core/src/validate.ts` implements the one Ajv format this protocol's schemas use (`date-time`) as a small local RFC 3339 regex-plus-`Date.parse` check rather than depending on `ajv-formats` for a single keyword.

## Consequences

- Removes the canonicalizer dependency from the content-addressing and signing path.
- The local implementation is covered by RFC-based test vectors.
- If a future contributor needs full arbitrary-precision JCS number handling (this repository does not use non-integer floats in any protocol-critical field), that would need to be added explicitly rather than inherited from a general-purpose library.
