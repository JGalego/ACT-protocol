export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export class SchemaValidationError extends LedgerError {
  constructor(details: string) {
    super(`Event failed schema validation: ${details}`, 'schema_invalid');
  }
}

export class DigestMismatchError extends LedgerError {
  constructor(claimed: string, recomputed: string) {
    super(
      `Claimed event_id ${claimed} does not match recomputed digest ${recomputed}`,
      'digest_mismatch',
    );
  }
}

export class InvalidSignatureError extends LedgerError {
  constructor(keyId: string) {
    super(`Signature from key_id ${keyId} did not verify`, 'invalid_signature');
  }
}

export class UntrustedActorError extends LedgerError {
  constructor(actorId: string, keyId: string) {
    super(
      `Actor ${actorId} / key ${keyId} is not trusted by this ledger's trust policy`,
      'untrusted_actor',
    );
  }
}

export class MissingParentError extends LedgerError {
  constructor(public readonly missingParentIds: string[]) {
    super(
      `Event references ${missingParentIds.length} causal parent(s) not present in this ledger: ${missingParentIds.join(', ')}`,
      'missing_parent',
    );
  }
}

export class CycleDetectedError extends LedgerError {
  constructor(public readonly cycleEventIds: string[]) {
    super(
      `Accepting this event would introduce a lineage cycle: ${cycleEventIds.join(' -> ')}`,
      'cycle_detected',
    );
  }
}

export class StorageConflictError extends LedgerError {
  constructor() {
    super(
      'Concurrent write conflict on ledger sequence/head; retry the append',
      'storage_conflict',
    );
  }
}

export class ActorKeyNotSignerError extends LedgerError {
  constructor(actorKeyId: string) {
    super(
      `The event claims actor key ${actorKeyId}, but no valid signature from that key is attached; an event can only be attributed to a key that actually signed it`,
      'actor_key_not_signer',
    );
  }
}

export class MissingSignatureError extends LedgerError {
  constructor() {
    super('An event must carry at least one signature', 'missing_signature');
  }
}

export class DuplicateParentError extends LedgerError {
  constructor(parentEventId: string) {
    super(
      `causal_parents names ${parentEventId} more than once; list each parent exactly once`,
      'duplicate_parent',
    );
  }
}

export class IdempotencyConflictError extends LedgerError {
  constructor(key: string, existingEventId: string) {
    super(
      `Idempotency key ${JSON.stringify(key)} was already used for a different event (${existingEventId})`,
      'idempotency_conflict',
    );
  }
}

export class ArtifactExistsError extends LedgerError {
  constructor(artifactId: string) {
    super(
      `Artifact ${artifactId} already has a genesis event; record a revision instead of a second root`,
      'artifact_exists',
    );
  }
}

export class TenantMismatchError extends LedgerError {
  constructor(expected: string, claimed: string) {
    super(
      `This ledger belongs to tenant ${JSON.stringify(expected)}; the event states ${claimed}. An event must name the tenant whose ledger records it`,
      'tenant_mismatch',
    );
  }
}
