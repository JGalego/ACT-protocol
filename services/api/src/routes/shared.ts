import { artifactTypeSchemaId, SCHEMA_IDS, validateAgainst } from '@act/core';
import type { SignedEnvelope } from '@act/crypto';
import type { Ledger } from '@act/ledger';
import { badRequest } from '../problem.js';
import type { KeyRegistry } from '../ledger-context.js';

export interface SubmitOptions {
  /** Restrict acceptance to these event_type values (e.g. ['genesis'] for POST /v1/intents). */
  allowedEventTypes?: string[];
  /** Restrict acceptance to these subject.kind values. */
  allowedSubjectKinds?: string[];
  allowPartialImport?: boolean;
}

const ARTIFACT_TYPE_SLUG_OVERRIDES: Record<string, string> = { AIProposal: 'ai-proposal' };

/** Mirrors scripts/generate-artifact-types.mjs's slug derivation so artifact_type names map to the matching generated schema. */
export function artifactTypeNameToSlug(name: string): string {
  if (ARTIFACT_TYPE_SLUG_OVERRIDES[name]) return ARTIFACT_TYPE_SLUG_OVERRIDES[name]!;
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

export function parseSignedEnvelope(body: unknown): SignedEnvelope {
  const envelopeResult = validateAgainst(SCHEMA_IDS.signedEnvelope, body);
  if (!envelopeResult.valid) {
    throw badRequest(
      'schema_invalid',
      'Request body is not a well-formed signed envelope',
      JSON.stringify(envelopeResult.errors),
    );
  }
  return body as SignedEnvelope;
}

/** Validates that an event's payload is a well-formed instance of a specific generated artifact-type schema (e.g. 'intent', 'task'). */
export function validateArtifactTypePayload(eventPayload: unknown, typeSlug: string): void {
  validateAgainstSchemaId(eventPayload, artifactTypeSchemaId(typeSlug), typeSlug);
}

export function validateAgainstSchemaId(
  eventPayload: unknown,
  schemaId: string,
  label: string,
): void {
  const result = validateAgainst(schemaId, eventPayload);
  if (!result.valid) {
    throw badRequest(
      'artifact_payload_invalid',
      `Event payload is not a well-formed ${label} record`,
      JSON.stringify(result.errors),
    );
  }
}

export function submitEnvelope(
  ledger: Ledger,
  keyRegistry: KeyRegistry,
  envelope: SignedEnvelope,
  options: SubmitOptions = {},
) {
  const payload = envelope.payload as { event_type: string; subject: { kind: string } };

  if (options.allowedEventTypes && !options.allowedEventTypes.includes(payload.event_type)) {
    throw badRequest(
      'event_type_not_allowed',
      `event_type '${payload.event_type}' is not accepted by this endpoint`,
      `Allowed: ${options.allowedEventTypes.join(', ')}`,
    );
  }
  if (options.allowedSubjectKinds && !options.allowedSubjectKinds.includes(payload.subject.kind)) {
    throw badRequest(
      'subject_kind_not_allowed',
      `subject.kind '${payload.subject.kind}' is not accepted by this endpoint`,
      `Allowed: ${options.allowedSubjectKinds.join(', ')}`,
    );
  }

  const publicKeys = keyRegistry.publicKeysByKeyId();
  const result = ledger.appendEvent(envelope, {
    publicKeys,
    allowPartialImport: options.allowPartialImport ?? false,
  });

  return {
    eventId: result.event.eventId,
    sequence: result.receipt.sequence,
    receipt: result.receipt,
    duplicate: result.duplicate,
  };
}
