# Versioning

ACT distinguishes four version axes that change independently.

| Axis                       | Where it appears                                                                                                | Current value                       | Changes when                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Protocol version**       | `protocol_version` field on every event and artifact envelope                                                   | `act/1.0`                           | The normative semantics in `spec/` change in a way that affects wire compatibility. Bumping the major protocol version is a breaking change per `spec/ACT-1.0.md` section 16. |
| **Schema version**         | The version segment in each schema's `$id` (`https://schemas.act-protocol.org/1.0/...`)                         | `1.0`                               | A schema's structural contract changes. Adding an optional field or a new artifact type is additive and does not require a bump; removing or narrowing a field does.          |
| **API version**            | The `/v1` path prefix in `services/api`                                                                         | `v1`                                | The HTTP contract's request/response shapes change incompatibly.                                                                                                              |
| **Implementation version** | `package.json`/`Cargo.toml`/`pyproject.toml`/`go.mod` version of a specific package, SDK, service, or CLI build | `1.0.0-rc.1` across this repository | Any release of that specific artifact, following semantic versioning.                                                                                                         |

## Why Four Axes, Not One

A protocol-version-`act/1.0`-compliant event can be produced by
implementation version `1.0.0-rc.1` today and by some future `2.3.0` next
year without either the protocol version or the schema version changing —
the implementation improved, the wire contract didn't. Conversely, a
schema addition (a new optional field) can ship in implementation `1.1.0`
without bumping `protocol_version`, because older `act/1.0` readers that
don't understand the new field are required (per `spec/ACT-1.0.md`
section 16.2) to preserve it unread rather than reject the event.

Conflating these axes — e.g. tying the API version to the npm package
version — would force an API-breaking release every time an internal
bugfix ships, or vice versa hide a genuine wire-incompatible change behind
a patch-level bump.

## Compatibility Rules

- A conforming reader MUST reject an event whose `protocol_version` major
  version it does not support (`spec/ACT-1.0.md` section 16.2) rather than
  guess at its meaning.
- A conforming reader MUST preserve fields it does not recognize through a
  read-write round trip when the major protocol version matches.
- Extension namespaces (`extensions.<reverse-dns>.*`) never require a
  protocol version bump; registering one follows `GOVERNANCE.md`'s
  Standards Adoption process (`docs/standards-adoption.md`).
- This repository's own `CHANGELOG.md` tracks implementation-version
  history only; protocol- and schema-version history, once this project
  ships a `1.1` or `2.0`, will be tracked in `spec/CHANGELOG.md` (not yet
  created, since `spec/` has not yet changed since `1.0`).
