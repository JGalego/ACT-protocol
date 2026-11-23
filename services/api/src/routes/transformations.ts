import type { FastifyPluginAsync } from 'fastify';
import { SCHEMA_IDS } from '@act/core';
import {
  parseSignedEnvelope,
  idempotencyKeyOf,
  submitEnvelope,
  validateAgainstSchemaId,
} from './shared.js';

const transformationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/transformations', async (request, reply) => {
    const ctx = request.ctx;
    const envelope = parseSignedEnvelope(request.body);
    validateAgainstSchemaId(envelope.payload.payload, SCHEMA_IDS.transformation, 'transformation');
    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: ['transformation_recorded'],
      allowedSubjectKinds: ['transformation'],
    });
    reply.code(201).send(result);
  });
};

export default transformationRoutes;
