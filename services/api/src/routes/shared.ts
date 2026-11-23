import type { FastifyRequest } from 'fastify';
import { artifactTypeSchemaId, SCHEMA_IDS, validateAgainst } from '@act/core';
import type { SignedEnvelope } from '@act/crypto';
import { badRequest, forbidden } from '../problem.js';
import type { LedgerContext } from '../ledger-context.js';
import { enforceProtocolSemantics } from '../semantics.js';
import { isAdmin } from '../tenancy.js';

export interface SubmitOptions {
  /** Restrict acceptance to these event_type values (e.g. ['genesis'] for POST /v1/intents). */
  allowedEventTypes?: string[];
  /** Restrict acceptance to these subject.kind values. */
  allowedSubjectKinds?: string[];
  allowPartialImport?: boolean;
  idempotencyKey?: string | undefined;
  /** Public keys not yet in the registry that may verify this envelope (self-registration). */
  extraPublicKeys?: Record<string, string>;
  /** Key ids trusted for this one append (self-registration). */
  additionalTrustedKeyIds?: string[];
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
  let result;
  try {
    result = validateAgainst(schemaId, eventPayload);
  } catch {
    // An unregistered schema id means the caller named a type this protocol
    // version does not define: a client error, not a server fault.
    throw badRequest('unknown_artifact_type', `Unknown artifact type '${label}'`);
  }
  if (!result.valid) {
    throw badRequest(
      'artifact_payload_invalid',
      `Event payload is not a well-formed ${label} record`,
      JSON.stringify(result.errors),
    );
  }
}

/**
 * Validates an event's body against the schema its own `artifact_type` names
 * (or the transformation schema). Every path that accepts events -- direct
 * submission and federation import alike -- runs this, so a malformed record
 * can never reach the ledger through the side door.
 */
export function validateEventBody(event: { event_type: string; payload: unknown }): void {
  const payload = event.payload as { artifact_type?: unknown } | null;
  if (payload && typeof payload.artifact_type === 'string') {
    validateArtifactTypePayload(payload, artifactTypeNameToSlug(payload.artifact_type));
  } else if (event.event_type === 'transformation_recorded') {
    validateAgainstSchemaId(payload, SCHEMA_IDS.transformation, 'transformation');
  }
}

/** The caller-chosen `Idempotency-Key` header, if any (both SDKs send it on every write). */
export function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  const raw = request.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 255) {
    throw badRequest('invalid_idempotency_key', 'Idempotency-Key must be 1-255 characters');
  }
  return value;
}

export { isAdmin };

export function assertAdmin(ctx: LedgerContext, request: FastifyRequest): void {
  if (!isAdmin(ctx, request.callerActorId)) {
    throw forbidden('This operation requires an administrator (ACT_ADMIN_ACTORS)');
  }
}

/** Parses an integer query parameter strictly; absent -> `fallback`; malformed or out of range -> 400. */
export function parseIntParam(
  name: string,
  raw: string | undefined,
  options: { fallback: number; min: number; max: number },
): number {
  if (raw === undefined || raw === '') return options.fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw badRequest('invalid_query_param', `${name} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
    throw badRequest(
      'invalid_query_param',
      `${name} must be between ${options.min} and ${options.max}`,
    );
  }
  return value;
}

export async function submitEnvelope(
  ctx: LedgerContext,
  envelope: SignedEnvelope,
  options: SubmitOptions = {},
) {
  const payload = envelope.payload as {
    event_type: string;
    subject: { kind: string };
    payload: unknown;
  };

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

  await ctx.keyRegistry.catchUp(ctx.ledger);
  const publicKeys = { ...ctx.keyRegistry.publicKeysByKeyId(), ...options.extraPublicKeys };

  // A resubmission of an already-accepted event is idempotent (spec section
  // 6.1 step 6): it must return the existing receipt, not be re-judged against
  // the lifecycle rules its first acceptance already satisfied. The ledger
  // still recomputes the digest before answering, so a forged id gets nothing.
  const alreadyAccepted = await ctx.ledger.getEvent(envelope.payloadDigest);
  if (!alreadyAccepted) {
    validateEventBody(payload);
    await enforceProtocolSemantics(ctx, envelope, publicKeys);
  }

  const result = await ctx.ledger.appendEvent(envelope, {
    publicKeys,
    allowPartialImport: options.allowPartialImport ?? false,
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.additionalTrustedKeyIds
      ? { additionalTrustedKeyIds: options.additionalTrustedKeyIds }
      : {}),
  });
  await ctx.keyRegistry.catchUp(ctx.ledger);
  await ctx.roleRegistry.catchUp(ctx.ledger);

  return {
    eventId: result.event.eventId,
    sequence: result.receipt.sequence,
    receipt: result.receipt,
    duplicate: result.duplicate,
  };
}
