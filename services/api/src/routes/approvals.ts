import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope, validateArtifactTypePayload } from './shared.js';

const approvalRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/approval-requests', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'approval-request');
    const result = submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: ['approval_requested'],
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });

  fastify.post('/v1/approval-decisions', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'approval-decision');
    const result = submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
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
    const { id } = request.params as { id: string };
    const event = ctx.ledger.getEvent(id);
    return { event };
  });
};

export default approvalRoutes;
