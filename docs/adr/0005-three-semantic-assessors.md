# ADR 0005: Independent Semantic Assessors

## Status

Accepted

## Context

`PROMPT.md` requires structural, provider-neutral AI, and human semantic assessors. Automated assessors may not silently approve semantic modifications. A deterministic local emulator is required for offline testing of external integrations.

## Decision

`packages/verification/src/semantic/` implements independent assessors with a shared attributed-assessment shape (`classification`, `confidence`, `rationale`, and provenance):

1. `structural-assessor.ts` — byte identity, then RFC 8785 canonical structural equality for JSON-parseable inputs, then a normalized-text Levenshtein similarity heuristic. Only the first two return `exact-preservation`; heuristic results state their confidence bounds and limitations.
2. `openai-compatible-assessor.ts` — a provider-neutral client for any OpenAI-compatible `/chat/completions` endpoint, with the compared texts wrapped in explicit `<<<DATA_A>>>`/`<<<DATA_B>>>` delimiters and a system prompt instructing the model never to treat their contents as instructions (prompt-injection defense), strict JSON-shape validation with retries, and full provenance capture (provider, model, prompt digest, sampling parameters, output digest) — never a required hidden chain-of-thought.
3. `mock-openai-server.ts` — a deterministic local HTTP emulator of the same `/chat/completions` contract, satisfying PROMPT.md's requirement that an external-service-shaped feature ship with a local, paid-service-free way to exercise it. It judges by exact-match-after-trim only; it is explicitly documented as testing the wire contract, not model quality.
4. `human-assessment.ts` — normalizes a human reviewer's classification into the same shape; the API and CLI are responsible for authentication, signing, and persistence of the resulting attestation. The implemented Explorer demonstration inspects attributed assessments, while human-assessment mutation remains part of its unclaimed full conformance profile (ADR 0001 and `docs/roadmap.md`).

Assessors do not write to the ledger or approve transformations. Authorization is evaluated separately through policy and approval-validity checks.

## Consequences

- Assessors return classification and confidence, not authorization verdicts. Callers must obtain authorization through the policy layer.
- The mock server's simplicity (exact-match-after-trim) means it proves the assessor's HTTP/JSON/retry/provenance machinery end-to-end but cannot substitute for evaluating real model judgment quality; that requires configuring a real endpoint, which the same client code supports unchanged.
