# ADR 0002: Hand-Rolled RFC 8785 Canonicalization Instead of a Dependency

## Status

Accepted

## Context

ACT's content-addressed identifiers (event ids, artifact-version ids, receipt digests) depend entirely on RFC 8785 (JSON Canonicalization Scheme) producing byte-identical output for equal values. We initially depended on the `canonicalize` npm package. Under this repository's `NodeNext` module resolution plus `esModuleInterop`, that package's CommonJS-with-ESM-shaped-`.d.ts` default export bound incorrectly at the type level (TypeScript resolved the import to the module namespace object rather than the exported function), and the same interop friction recurred with `ajv-formats`.

## Decision

`packages/core/src/canonical.ts` implements RFC 8785 directly for the strict JSON data model (object/array/string/number/boolean/null) rather than depending on a third-party package. For this restricted data model, JCS reduces to two rules: (1) recursively sort object keys by UTF-16 code unit, and (2) reuse ECMAScript's own `JSON.stringify` for every leaf value and every key, which already implements JCS-compatible number formatting (ECMA-262 `Number::toString`) and string escaping. The implementation is under 40 lines and is covered by unit tests including a known JCS unicode-escaping test vector.

Similarly, `packages/core/src/validate.ts` implements the one Ajv format this protocol's schemas use (`date-time`) as a small local RFC 3339 regex-plus-`Date.parse` check rather than depending on `ajv-formats` for a single keyword.

## Consequences

- One fewer runtime dependency in a package whose correctness is security-critical (content addressing and signing both depend on it), which is a legitimate goal in its own right beyond working around the interop issue.
- The implementation is small enough to read and audit in one sitting, and is directly tested against the RFC's own guarantees rather than trusted as a black box.
- If a future contributor needs full arbitrary-precision JCS number handling (this repository does not use non-integer floats in any protocol-critical field), that would need to be added explicitly rather than inherited from a general-purpose library.
