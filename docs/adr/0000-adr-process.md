# ADR 0000: Architecture Decision Record Process

## Status

Accepted

## Context

`PROMPT.md` (the build specification for this repository) requires that
"when a minor implementation detail is unspecified, choose the simplest
secure design consistent with this document, record the choice in an
Architecture Decision Record, and continue." `GOVERNANCE.md` requires
normative protocol changes to be accompanied by an ADR and Spec Editor
sign-off.

## Decision

Every ADR lives under `docs/adr/`, is numbered sequentially
(`NNNN-kebab-case-title.md`), and follows this shape:

```markdown
# ADR NNNN: Title

## Status

Proposed | Accepted | Superseded by ADR NNNN

## Context

What problem or ambiguity forced a decision.

## Decision

What was decided, stated as a direct claim.

## Consequences

What this makes easier, harder, or explicitly out of scope as a result.
```

An ADR is never deleted; a changed decision is recorded as a new ADR that
marks the old one "Superseded by ADR NNNN."

## Consequences

Every non-obvious design choice in this repository — including scope
reductions from `PROMPT.md`'s full ambition to this release's actual
implementation — is traceable to a specific, dated rationale instead of
being silently assumed. See `docs/roadmap.md` for the consolidated list of
what is deferred and why.
