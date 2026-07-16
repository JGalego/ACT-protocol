# ADR 0005: Three Independent Semantic Assessors, None Authoritative Alone

## Status

Accepted

## Context

`PROMPT.md` requires "three usable semantic assessors" — deterministic
structural, provider-neutral AI, and human — and explicitly forbids any
automated assessor from "silently approving semantic modifications." It
also requires a deterministic local emulator for any external-service
dependency, so the AI assessor is usable and testable without a paid
service.

## Decision

`packages/verification/src/semantic/` implements all three as
independent, side-by-side modules producing the same attributed-assessment
shape (`classification`, `confidence`, `rationale`, plus provenance):

1. `structural-assessor.ts` — byte identity, then RFC 8785 canonical
   structural equality for JSON-parseable inputs, then a normalized-text
   Levenshtein similarity heuristic. `exact-preservation` is returned only
   for the first two (genuinely mechanical) cases; everything else is an
   explicitly bounded-confidence heuristic with a rationale that says so.
2. `openai-compatible-assessor.ts` — a provider-neutral client for any
   OpenAI-compatible `/chat/completions` endpoint, with the compared texts
   wrapped in explicit `<<<DATA_A>>>`/`<<<DATA_B>>>` delimiters and a
   system prompt instructing the model never to treat their contents as
   instructions (prompt-injection defense), strict JSON-shape validation
   with retries, and full provenance capture (provider, model, prompt
   digest, sampling parameters, output digest) — never a required hidden
   chain-of-thought.
3. `mock-openai-server.ts` — a deterministic local HTTP emulator of the
   same `/chat/completions` contract, satisfying PROMPT.md's requirement
   that an external-service-shaped feature ship with a local, paid-service-free
   way to exercise it. It judges by exact-match-after-trim only; it is
   explicitly documented as testing the wire contract, not model quality.
4. `human-assessment.ts` — normalizes a human reviewer's classification
   into the same shape; the API/CLI/Explorer surfaces (Explorer deferred,
   ADR 0001) are responsible for authentication, signing, and persistence
   of the resulting attestation.

None of the three modules writes to the ledger or marks a transformation
approved on its own; `packages/policy`'s approval-requirement evaluation
and `packages/verification`'s approval-validity checks are the only code
paths that determine whether a semantic-modification transition is
authorized, and they require an actual Approval Decision record.

## Consequences

- A caller cannot accidentally wire the AI or structural assessor
  directly into an authorization decision, because neither module returns
  or claims a "required" or "approved" verdict — only a classification
  and confidence for a human or policy layer to act on.
- The mock server's simplicity (exact-match-after-trim) means it proves
  the assessor's HTTP/JSON/retry/provenance machinery end-to-end but
  cannot substitute for evaluating real model judgment quality; that
  requires configuring a real endpoint, which the same client code
  supports unchanged.
