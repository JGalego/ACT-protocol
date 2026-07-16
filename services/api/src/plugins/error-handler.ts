import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { LedgerError } from '@act/ledger';
import { ApiProblemError, type ProblemDetails } from '../problem.js';

const LEDGER_ERROR_STATUS: Record<string, number> = {
  schema_invalid: 400,
  digest_mismatch: 400,
  invalid_signature: 401,
  untrusted_actor: 403,
  missing_parent: 409,
  cycle_detected: 409,
};

const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((rawErr, request, reply) => {
    const err = rawErr as Error & { validation?: unknown; statusCode?: number };
    let problem: ProblemDetails;

    if (err instanceof ApiProblemError) {
      problem = err.toProblem(request.url);
    } else if (err instanceof LedgerError) {
      const status = LEDGER_ERROR_STATUS[err.code] ?? 400;
      problem = {
        type: `https://schemas.act-protocol.org/1.0/errors/${err.code}`,
        title: err.message,
        status,
        instance: request.url,
        code: err.code,
      };
    } else if (err.validation) {
      problem = {
        type: 'https://schemas.act-protocol.org/1.0/errors/schema_invalid',
        title: 'Request failed schema validation',
        status: 400,
        detail: err.message,
        instance: request.url,
        code: 'schema_invalid',
      };
    } else if (typeof err.statusCode === 'number' && err.statusCode < 500) {
      problem = {
        type: 'about:blank',
        title: err.message,
        status: err.statusCode,
        instance: request.url,
        code: 'request_error',
      };
    } else {
      request.log.error(err, 'unhandled error');
      problem = {
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        instance: request.url,
        code: 'internal_error',
      };
    }

    reply.code(problem.status).type('application/problem+json').send(problem);
  });
};

export default fp(errorHandlerPlugin, { name: 'act-error-handler' });
