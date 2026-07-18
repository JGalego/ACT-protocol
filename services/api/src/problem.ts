/** RFC 9457 Problem Details, with a stable ACT-specific error code. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
}

export class ApiProblemError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    title: string,
    public readonly detail?: string,
  ) {
    super(title);
    this.name = 'ApiProblemError';
  }

  toProblem(instance?: string): ProblemDetails {
    return {
      type: `https://schemas.act-protocol.org/1.0/errors/${this.code}`,
      title: this.message,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(instance ? { instance } : {}),
      code: this.code,
    };
  }
}

export function badRequest(code: string, title: string, detail?: string): ApiProblemError {
  return new ApiProblemError(400, code, title, detail);
}
export function unauthorized(detail?: string): ApiProblemError {
  return new ApiProblemError(401, 'unauthorized', 'Authentication required', detail);
}
export function forbidden(detail?: string): ApiProblemError {
  return new ApiProblemError(403, 'forbidden', 'Not authorized to perform this action', detail);
}
export function notFound(detail?: string): ApiProblemError {
  return new ApiProblemError(404, 'not_found', 'Resource not found', detail);
}
export function conflict(code: string, title: string, detail?: string): ApiProblemError {
  return new ApiProblemError(409, code, title, detail);
}
export function badGateway(code: string, title: string, detail?: string): ApiProblemError {
  return new ApiProblemError(502, code, title, detail);
}
