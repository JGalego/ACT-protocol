import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { badRequest, notFound } from '../problem.js';
import { diffValues } from '../diff.js';
import {
  artifactTypeNameToSlug,
  parseSignedEnvelope,
  submitEnvelope,
  validateArtifactTypePayload,
} from './shared.js';

/**
 * Generic artifact-version submission, covering every artifact type not
 * already served by a dedicated endpoint (Intent and Transformation have
 * their own routes for clarity; this route serves Goal, Constraint,
 * Requirement, Assumption, Task, Decision, Revision, Evidence, and the
 * rest). The specific artifact_type schema is looked up dynamically.
 */
const artifactRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/artifacts', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    const artifactPayload = envelope.payload.payload as { artifact_type?: string };
    if (artifactPayload?.artifact_type) {
      validateArtifactTypePayload(
        envelope.payload.payload,
        artifactTypeNameToSlug(artifactPayload.artifact_type),
      );
    }
    const result = await submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: [
        'genesis',
        'artifact_revised',
        'external_import',
        'content_redacted',
        'content_erased',
      ],
      allowedSubjectKinds: ['artifact'],
    });
    reply.code(201).send(result);
  });

  fastify.get('/v1/artifacts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const head = await ctx.ledger.getHead(id);
    if (!head) throw notFound(`No artifact found with id ${id}`);
    const event = await ctx.ledger.getEvent(head.eventId);
    return { artifactId: id, currentVersionId: head.versionId, event };
  });

  fastify.get('/v1/artifacts/:id/versions', async (request) => {
    const { id } = request.params as { id: string };
    const events = await ctx.ledger.listEventsForArtifact(id);
    return { items: events };
  });

  fastify.get('/v1/artifacts/:id/diff', async (request) => {
    const { id } = request.params as { id: string };
    const { from, to } = request.query as { from?: string; to?: string };
    if (!from || !to) {
      throw badRequest(
        'missing_query_param',
        'Both "from" and "to" version ids are required',
        'Example: /v1/artifacts/<id>/diff?from=<versionId>&to=<versionId>',
      );
    }

    const versions = await ctx.ledger.listEventsForArtifact(id);
    const fromEvent = versions.find((e) => e.subjectVersionId === from);
    const toEvent = versions.find((e) => e.subjectVersionId === to);
    if (!fromEvent) throw notFound(`No version "${from}" found for artifact ${id}`);
    if (!toEvent) throw notFound(`No version "${to}" found for artifact ${id}`);

    const diff = diffValues(fromEvent.envelope.payload.payload, toEvent.envelope.payload.payload);
    return {
      artifactId: id,
      from: { versionId: from, eventId: fromEvent.eventId },
      to: { versionId: to, eventId: toEvent.eventId },
      diff,
    };
  });
};

export default artifactRoutes;
