# Conformance Vectors

Committed reference outputs used by the SDK conformance tests. Regenerate only when `packages/core` or `packages/crypto` change:

```bash
pnpm run conformance:generate-vectors
```

`generate-vectors.ts` calls `@act/core` and `@act/crypto` to produce expected outputs. The canonicalization cases include negative zero becoming `"0"`, the precision boundary at `2^53`, and ECMAScript's exponential-notation thresholds. Other SDKs must reproduce these strings exactly.

Regeneration creates new random keypairs and signatures. It does not reproduce the committed key material; do not run it as routine cleanup.

| File | Contents |
| --- | --- |
| `canonicalization.json` | RFC 8785 canonical-form vectors: structural cases (key sort, nesting, unicode, dropped `undefined`) and a number-formatting matrix |
| `digest.json` | SHA-256 digest vectors, both over raw bytes and over canonicalized values |
| `ids.json` | UUIDv7 format-validation vectors (valid/invalid, not fresh generation — randomness itself can't be vectorized) |
| `dsse-pae.json` | DSSE Pre-Authentication-Encoding vectors, including the well-known `"DSSEv1 29 http://example.com/HelloWorld 11 hello world"` vector |
| `keys.json` | Fixed Ed25519 keypairs and their expected `key_id` (`ed25519:<sha-256 fingerprint>`) |
| `signatures.json` | Ed25519 signatures over a fixed message with the fixed keypairs above — deterministic per RFC 8032, so a fixed keypair + fixed message always yields the same signature bytes in every conformant implementation |
| `envelopes.json` | Full signed-envelope vectors (payload digest + signatures) |
| `key-lifecycle.json` | `evaluateKeyValidityAt` vectors, including the compromised-key retroactive grace-period boundary |
