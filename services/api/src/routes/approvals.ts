import type { FastifyPluginAsync } from 'fastify';
import {
  parseSignedEnvelope,
  idempotencyKeyOf,
  submitEnvelope,
  validateArtifactTypePayload,
} from './shared.js';

const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/approval-requests', async (request, reply) => {
    const ctx = request.ctx;
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'approval-request');
    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: ['approval_requested'],
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });

  fastify.post('/v1/approval-decisions', async (request, reply) => {
    const ctx = request.ctx;
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'approval-decision');
    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: [
        'approval_decided',
        'approval_cancelled',
        'approval_revoked',
        'approval_expired',
      ],
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });

  fastify.get('/v1/approvals/:id', async (request) => {
    const ctx = request.ctx;
    const { id } = request.params as { id: string };
    const event = await ctx.ledger.getEvent(id);
    return { event };
  });
};

export default approvalRoutes;
