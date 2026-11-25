# ACT Python SDK

A Python client for constructing, signing, and submitting [ACT protocol](https://act-protocol.org) events, matching the functionality of `packages/sdk-typescript` (`@act/sdk`):

| Module | Mirrors | Contents |
| --- | --- | --- |
| `act_sdk.core` | `packages/core` | RFC 8785 canonicalization, SHA-256 digests, UUIDv7 ids |
| `act_sdk.crypto` | `packages/crypto` | Ed25519 keys, DSSE envelope sign/verify, key lifecycle evaluation |
| `act_sdk.event_builder` | `packages/sdk-typescript/src/event-builder.ts` | Unsigned-event construction with protocol defaults filled in |
| `act_sdk.client` | `packages/sdk-typescript/src/client.ts` | A thin, retrying HTTP client for the ACT reference API |

## Install

```bash
pip install -e ".[dev]"
```

## Conformance

`tests/test_vectors.py` checks canonicalization, digests, DSSE PAE, keys, signatures, envelopes, and key lifecycle against the same frozen vectors used by TypeScript. Ed25519 is deterministic (RFC 8032), so `test_signatures` compares Python's signature bytes with TypeScript's for identical inputs. Fixtures under `../../conformance/interop/` also check signature verification in both directions.

Run the whole suite:

```bash
pytest
```

## Number formatting

RFC 8785 requires JSON number formatting to match ECMAScript's `Number::toString`, which is not what Python's own float formatting produces. `act_sdk.core.canonical` reuses `repr()` only to obtain the shortest round-tripping decimal digit string (via `decimal.Decimal`), then re-formats those digits with ECMA-262's exact fixed/exponential-notation thresholds. See the module docstring and `conformance/vectors/canonicalization.json`'s `numbers` section for the edge cases this handles (negative zero, the `2^53` precision-loss boundary, exponential-notation thresholds, subnormals).

## Key ordering

RFC 8785 section 3.2.3 requires object keys sorted by UTF-16 code unit sequence, not Python's code-point ordering -- `act_sdk.core.canonical` sorts by each key's UTF-16BE encoding rather than the raw string, so a key containing a character outside the Basic Multilingual Plane sorts identically to every other ACT implementation.
