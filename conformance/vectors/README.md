# Conformance Vectors

Generated artifacts, checked into git — the single source of truth every SDK's conformance suite (including the TypeScript SDK's own tests, so it can never silently drift from its own vectors) loads. Regenerate only when `packages/core` or `packages/crypto` change:

```bash
pnpm run conformance:generate-vectors
```

Every value here comes from running the REAL implementation (`conformance/vectors/generate-vectors.ts` imports `@act/core`/`@act/crypto` directly) — nothing here is hand-derived. In particular `canonicalization.json`'s `numbers` section is the actual byte-for-byte RFC 8785 output for edge cases a naive port would get wrong: negative zero collapsing to `"0"`, the precision loss boundary at `2^53`, and JS's exponential-notation thresholds. A correct Python/Go/Rust canonicalizer must reproduce these exact strings, not merely "a reasonable-looking" serialization.

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
