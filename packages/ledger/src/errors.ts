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
