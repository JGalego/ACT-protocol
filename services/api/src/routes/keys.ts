import type { FastifyPluginAsync } from 'fastify';
import type { SignedEnvelope } from '@act/crypto';
import { ApiProblemError, forbidden } from '../problem.js';
import { evaluateKeyEvent } from '../key-registry.js';
import {
  idempotencyKeyOf,
  isAdmin,
  parseSignedEnvelope,
  submitEnvelope,
  validateArtifactTypePayload,
} from './shared.js';

/**
 * Key registration and lifecycle. The key registry is a projection of the
 * ledger's own events (see key-registry.ts), so everything here is "validate,
 * append, let the projection catch up" -- there is no side channel that can
 * make a key trusted without a ledger event that says so.
 *
 * Trust bootstrap (docs/adr/0006): a new key signs its own registration, which
 * proves possession of the private key. The key id must be the fingerprint of
 * the public key, so a key id cannot be claimed for someone else's key.
 * Who may bootstrap at all is an operator decision (`ACT_KEY_REGISTRATION`):
 * `open` accepts any proof of possession, `admin` (the production default)
 * restricts registration to administrators.
 */
const keyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/keys', async (request, reply) => {
    const ctx = request.ctx;
    const envelope: SignedEnvelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'key');

    await ctx.keyRegistry.catchUp(ctx.ledger);
    const outcome = evaluateKeyEvent(ctx.keyRegistry, envelope);
    if (outcome.kind === 'not-a-key-event') {
      throw new ApiProblemError(
        400,
        'event_type_not_allowed',
        `event_type '${(envelope.payload as { event_type: string }).event_type}' is not accepted by this endpoint`,
        'Allowed: genesis, key_issued, key_rotated, key_revoked, key_compromised',
      );
    }
    if (outcome.kind === 'reject') {
      throw new ApiProblemError(outcome.httpStatus, outcome.code, outcome.message);
    }

    if (outcome.kind === 'register' && ctx.policy.keyRegistration === 'admin') {
      if (!isAdmin(ctx, request.callerActorId)) {
        throw forbidden(
          'Key registration is restricted to administrators (ACT_KEY_REGISTRATION=admin)',
        );
      }
    }

    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: ['genesis', 'key_issued', 'key_rotated', 'key_revoked', 'key_compromised'],
      allowedSubjectKinds: ['artifact'],
      // A registering key cannot already be in the registry; trust it for this one append only.
      ...(outcome.kind === 'register'
        ? {
            extraPublicKeys: { [outcome.keyId]: outcome.publicKey },
            additionalTrustedKeyIds: [outcome.keyId],
          }
        : {}),
    });
    reply.code(201).send(result);
  });
};

export default keyRoutes;
