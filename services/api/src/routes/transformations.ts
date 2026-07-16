import type { FastifyPluginAsync } from 'fastify';
import { SCHEMA_IDS } from '@act/core';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope, validateAgainstSchemaId } from './shared.js';

const transformationRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (
  fastify,
  { ctx },
) => {
  fastify.post('/v1/transformations', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateAgainstSchemaId(envelope.payload.payload, SCHEMA_IDS.transformation, 'transformation');
    const result = submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: ['transformation_recorded'],
      allowedSubjectKinds: ['transformation'],
    });
    reply.code(201).send(result);
  });
};

export default transformationRoutes;
