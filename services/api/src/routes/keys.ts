import type { FastifyPluginAsync } from 'fastify';
import { verifyEnvelope } from '@act/crypto';
import { badRequest } from '../problem.js';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope } from './shared.js';

interface KeyArtifactPayload {
  artifact_type: 'Key';
  data: {
    key_id: string;
    algorithm: string;
    public_key: string;
    status: string;
    owner_actor_id: string;
  };
}

/**
 * Key registration is this API's trust bootstrap (documented Phase 1
 * simplification, see docs/adr/0006-api-authentication-and-trust-bootstrap.md):
 * the new key signs its own registration event, and the raw public key
 * needed to verify that signature travels inside the same request body
 * (the Key artifact's own `data.public_key` field). If the embedded public
 * key genuinely produces the attached signature, that is accepted as
 * proof of possession and the key becomes trusted for all subsequent
 * ledger writes.
 */
const keyRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/keys', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    const eventPayload = envelope.payload as {
      payload: KeyArtifactPayload;
      actor: { key_id: string };
    };
    const keyPayload = eventPayload.payload;

    if (keyPayload?.artifact_type !== 'Key' || !keyPayload.data?.public_key) {
      throw badRequest(
        'invalid_key_payload',
        'Event payload must be a Key artifact version with data.public_key set',
      );
    }
    if (eventPayload.actor.key_id !== keyPayload.data.key_id) {
      throw badRequest(
        'key_id_mismatch',
        "The signing actor.key_id must equal the registered Key record's key_id (self-registration)",
      );
    }

    const proofCheck = verifyEnvelope(envelope, {
      [keyPayload.data.key_id]: keyPayload.data.public_key,
    });
    const selfSignatureValid = proofCheck.signatures.some(
      (s) => s.key_id === keyPayload.data.key_id && s.valid,
    );
    if (!proofCheck.digestValid || !selfSignatureValid) {
      throw badRequest(
        'proof_of_possession_failed',
        'The embedded public key does not produce the attached signature; cannot prove possession of the private key',
      );
    }

    // Proof of possession established above; register the key as trusted
    // BEFORE appending, since the ledger's own trust-policy check (a
    // second, independent evaluation -- ACT-1.0.md section 4.5) consults
    // this same registry. Roll back on any append failure so a rejected
    // event can never leave a phantom trusted key behind.
    ctx.keyRegistry.register({
      keyId: keyPayload.data.key_id,
      publicKey: keyPayload.data.public_key,
      ownerActorId: keyPayload.data.owner_actor_id,
      status: keyPayload.data.status as 'issued' | 'active',
    });

    try {
      const result = await submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
        allowedEventTypes: ['genesis', 'key_issued'],
        allowedSubjectKinds: ['artifact'],
      });
      reply.code(201).send(result);
    } catch (err) {
      ctx.keyRegistry.unregister(keyPayload.data.key_id);
      throw err;
    }
  });
};

export default keyRoutes;
