import type { SignedEnvelope } from '@act/crypto';

export interface ActClientOptions {
  baseUrl: string;
  bearerToken?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
}

/** An RFC 9457 Problem Details error response, thrown as a typed error by ActClient. */
export class ActApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly problem: ProblemDetails,
  ) {
    super(message);
    this.name = 'ActApiError';
  }
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * A thin, retrying HTTP client for the ACT reference API. Every write
 * method takes an already-signed envelope built with @act/crypto -- this
 * client never signs on the caller's behalf, preserving non-repudiation.
 */
export class ActClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options: ActClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.bearerToken = options.bearerToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
  }

  submitIntent(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/intents', envelope, idempotencyKey);
  }

  submitTransformation(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/transformations', envelope, idempotencyKey);
  }

  submitArtifact(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/artifacts', envelope, idempotencyKey);
  }

  submitApprovalRequest(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/approval-requests', envelope, idempotencyKey);
  }

  submitApprovalDecision(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/approval-decisions', envelope, idempotencyKey);
  }

  submitChallenge(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/challenges', envelope, idempotencyKey);
  }

  submitVerification(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/verifications', envelope, idempotencyKey);
  }

  registerActor(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/actors', envelope, idempotencyKey);
  }

  registerKey(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/keys', envelope, idempotencyKey);
  }

  publishPolicy(envelope: SignedEnvelope, idempotencyKey?: string) {
    return this.post('/v1/policies', envelope, idempotencyKey);
  }

  getArtifact(artifactId: string) {
    return this.get(`/v1/artifacts/${encodeURIComponent(artifactId)}`);
  }

  getArtifactVersions(artifactId: string) {
    return this.get(`/v1/artifacts/${encodeURIComponent(artifactId)}/versions`);
  }

  getLineage(id: string, maxDepth?: number) {
    return this.get(
      `/v1/lineage/${encodeURIComponent(id)}`,
      maxDepth ? { maxDepth: String(maxDepth) } : undefined,
    );
  }

  getHistory(id: string) {
    return this.get(`/v1/history/${encodeURIComponent(id)}`);
  }

  async listEvents(cursor?: string, limit = 50): Promise<PagedResult<unknown>> {
    return this.get('/v1/events', {
      ...(cursor ? { cursor } : {}),
      limit: String(limit),
    }) as Promise<PagedResult<unknown>>;
  }

  health() {
    return this.get('/v1/health/live');
  }

  exportBundle(scopeArtifactIds?: string[]) {
    return this.post('/v1/bundles/export', { artifactIds: scopeArtifactIds ?? [] });
  }

  importBundle(bundle: Record<string, unknown>) {
    return this.post('/v1/bundles/import', bundle);
  }

  private async post(path: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    return this.request('POST', path, body, idempotencyKey);
  }

  private async get(path: string, query?: Record<string, string>): Promise<unknown> {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    return this.request('GET', `${path}${qs}`);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.bearerToken) headers.authorization = `Bearer ${this.bearerToken}`;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (response.status >= 500 && attempt < this.maxRetries) {
          await sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }
        if (!response.ok) {
          const problem = (await safeJson(response)) as ProblemDetails;
          throw new ActApiError(
            problem.title ?? `HTTP ${response.status}`,
            response.status,
            problem,
          );
        }
        if (response.status === 204) return undefined;
        return await response.json();
      } catch (err) {
        if (err instanceof ActApiError) throw err;
        lastError = err;
        if (attempt < this.maxRetries) {
          await sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('ActClient request failed');
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { type: 'about:blank', title: `HTTP ${response.status}`, status: response.status };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
