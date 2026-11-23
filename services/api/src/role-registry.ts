import type { SignedEnvelope } from '@act/crypto';
import type { Ledger, StoredEvent } from '@act/ledger';
import type { KeyRegistry } from './key-registry.js';

/**
 * Accountability assignments (spec section 8.4, ADR 0011).
 *
 * An assignment is an artifact; its versions are `accountability_assigned`
 * events. The first version grants a role (`status: active`); later versions
 * (each a `revision-of` its predecessor) can only end or revoke it, or move
 * its `end_time`. This registry is a projection of the tenant's own ledger and
 * is never written directly.
 */

export type AssignmentStatus = 'active' | 'ended' | 'revoked';

export interface AssignmentVersion {
  eventId: string;
  status: AssignmentStatus;
  endTime: string | null;
  /** Ledger acceptance time; never the issuer's claimed time. */
  acceptedAt: string;
  /** Actor that recorded this version. */
  recordedBy: string;
}

export interface Assignment {
  assignmentId: string;
  role: string;
  assigneeId: string;
  scope: string;
  issuerId: string;
  startTime: string;
  versions: AssignmentVersion[];
}

interface AssignmentData {
  role?: string;
  assignee?: { actor_id?: string; key_id?: string };
  scope?: string;
  issuer?: { actor_id?: string; key_id?: string };
  authority?: string;
  start_time?: string;
  end_time?: string | null;
  status?: string;
}

/** The authorization half of the decision. The write path supplies it; replay does not (the administrators then in force are not in the log). */
export interface AssignmentAuthorizer {
  /** Is `actorId` an administrator of this tenant? */
  isAdministrator(actorId: string): boolean;
  /** Evaluation time in epoch milliseconds (the moment this event is being accepted). */
  nowMs: number;
  keyRegistry: KeyRegistry;
}

export type AssignmentOutcome =
  | { kind: 'not-an-assignment' }
  | {
      kind: 'grant';
      assignment: Omit<Assignment, 'versions'>;
      status: 'active';
      endTime: string | null;
    }
  | { kind: 'revise'; assignmentId: string; status: AssignmentStatus; endTime: string | null }
  | { kind: 'reject'; httpStatus: number; code: string; message: string };

const reject = (httpStatus: number, code: string, message: string): AssignmentOutcome => ({
  kind: 'reject',
  httpStatus,
  code,
  message,
});

const TERMINAL: ReadonlySet<string> = new Set(['ended', 'revoked']);

/**
 * Decides what an `accountability_assigned` event means against the current
 * registry. One pure function serves the write path (with an authorizer) and
 * replay (without), so the live registry and a rebuild cannot disagree on
 * anything except who was an administrator at the time, which only the write
 * path can know.
 */
export function evaluateAssignmentEvent(
  registry: RoleRegistry,
  envelope: SignedEnvelope,
  authorizer: AssignmentAuthorizer | null,
): AssignmentOutcome {
  const event = envelope.payload as {
    event_type?: string;
    actor?: { actor_id?: string; key_id?: string };
    subject?: { artifact_id?: string };
    causal_parents?: { event_id: string; relation?: string }[];
    payload?: { artifact_type?: string; data?: AssignmentData };
  };
  if (event.event_type !== 'accountability_assigned') return { kind: 'not-an-assignment' };
  if (event.payload?.artifact_type !== 'AccountabilityAssignment') {
    return reject(
      400,
      'assignment_payload_invalid',
      'accountability_assigned must carry an AccountabilityAssignment artifact',
    );
  }

  const data = event.payload.data;
  const actorId = event.actor?.actor_id;
  const assignmentId = event.subject?.artifact_id;
  if (
    !data?.role ||
    !data.assignee?.actor_id ||
    !data.scope ||
    !data.issuer?.actor_id ||
    !data.start_time ||
    !data.status ||
    !actorId ||
    !assignmentId
  ) {
    return reject(400, 'assignment_payload_invalid', 'The assignment is missing required fields');
  }
  if (data.status !== 'active' && data.status !== 'ended' && data.status !== 'revoked') {
    return reject(400, 'assignment_payload_invalid', `Unknown assignment status ${data.status}`);
  }
  const startMs = Date.parse(data.start_time);
  const endMs = data.end_time ? Date.parse(data.end_time) : null;
  if (Number.isNaN(startMs) || (endMs !== null && Number.isNaN(endMs))) {
    return reject(400, 'assignment_payload_invalid', 'start_time and end_time must be timestamps');
  }
  if (endMs !== null && endMs <= startMs) {
    return reject(400, 'assignment_payload_invalid', 'end_time must be after start_time');
  }
  const endTime = data.end_time ?? null;

  const existing = registry.get(assignmentId);

  // ---- first version: a grant
  if (!existing) {
    // A grant is recorded by the one who issues it. (A later version may be recorded by someone
    // else with authority over it; the original issuer then stays named in the data.)
    if (data.issuer.actor_id !== actorId || data.issuer.key_id !== event.actor?.key_id) {
      return reject(
        403,
        'issuer_mismatch',
        'The assignment must be recorded by its issuer: issuer must be the event actor and key',
      );
    }
    if (data.status !== 'active') {
      return reject(409, 'invalid_assignment_transition', 'A new assignment starts as active');
    }
    if (authorizer) {
      const denied = grantDenied(registry, authorizer, actorId, data.assignee.actor_id, data.scope);
      if (denied) return reject(403, 'assignment_not_authorized', denied);
      const assigneeKey = data.assignee.key_id
        ? authorizer.keyRegistry.get(data.assignee.key_id)
        : undefined;
      if (!assigneeKey || assigneeKey.ownerActorId !== data.assignee.actor_id) {
        return reject(
          400,
          'unknown_assignee',
          'The assignee must be an actor with a registered key in this tenant',
        );
      }
    }
    return {
      kind: 'grant',
      assignment: {
        assignmentId,
        role: data.role,
        assigneeId: data.assignee.actor_id,
        scope: data.scope,
        issuerId: actorId,
        startTime: data.start_time,
      },
      status: 'active',
      endTime,
    };
  }

  // ---- a later version: end, revoke, or move end_time
  const latest = existing.versions[existing.versions.length - 1]!;
  const revisionOf = event.causal_parents?.find((p) => p.relation === 'revision-of');
  if (!revisionOf || revisionOf.event_id !== latest.eventId) {
    return reject(
      409,
      'not_latest_version',
      'A revision must name the assignment’s latest version as its revision-of parent',
    );
  }
  if (
    data.role !== existing.role ||
    data.assignee.actor_id !== existing.assigneeId ||
    data.scope !== existing.scope ||
    data.issuer.actor_id !== existing.issuerId ||
    data.start_time !== existing.startTime
  ) {
    return reject(
      409,
      'assignment_field_immutable',
      'Only status and end_time may change; role, assignee, scope, issuer and start_time are fixed',
    );
  }
  if (TERMINAL.has(latest.status)) {
    return reject(
      409,
      'invalid_assignment_transition',
      `A ${latest.status} assignment is final; grant a new one instead`,
    );
  }
  if (authorizer) {
    const denied = reviseDenied(registry, authorizer, actorId, existing, data.status);
    if (denied) return reject(403, 'assignment_not_authorized', denied);
  }
  return { kind: 'revise', assignmentId, status: data.status, endTime };
}

function grantDenied(
  registry: RoleRegistry,
  a: AssignmentAuthorizer,
  issuerId: string,
  assigneeId: string,
  scope: string,
): string | null {
  if (a.isAdministrator(issuerId)) return null;
  if (!registry.holds(issuerId, 'owner', scope, a.nowMs)) {
    return 'Only a tenant administrator, or an active owner of the scope, may grant a role';
  }
  if (issuerId === assigneeId) {
    return 'An owner may not grant a role to themselves';
  }
  return null;
}

function reviseDenied(
  registry: RoleRegistry,
  a: AssignmentAuthorizer,
  actorId: string,
  existing: Assignment,
  newStatus: AssignmentStatus,
): string | null {
  if (a.isAdministrator(actorId) || actorId === existing.issuerId) return null;
  // The assignee may resign (ended) but cannot revoke or extend their own role.
  if (actorId === existing.assigneeId) {
    return newStatus === 'ended'
      ? null
      : 'The assignee may only end their own assignment, not revoke or extend it';
  }
  if (registry.holds(actorId, 'owner', existing.scope, a.nowMs)) return null;
  return 'Only the issuer, the assignee (to end it), a tenant administrator, or an owner of the scope may change an assignment';
}

/** Projection of a tenant's accountability assignments. Only natively accepted assignments are applied. */
export class RoleRegistry {
  private readonly assignments = new Map<string, Assignment>();
  private lastSequence = -1;
  private chain: Promise<unknown> = Promise.resolve();

  get(assignmentId: string): Assignment | undefined {
    return this.assignments.get(assignmentId);
  }

  list(filter: { actorId?: string; scope?: string; activeAtMs?: number } = {}): Assignment[] {
    return [...this.assignments.values()].filter((a) => {
      if (filter.actorId && a.assigneeId !== filter.actorId) return false;
      if (filter.scope && a.scope !== filter.scope) return false;
      if (filter.activeAtMs !== undefined && !isActiveAt(a, filter.activeAtMs)) return false;
      return true;
    });
  }

  /** Roles the actor holds for `scope` at `atMs`. */
  rolesOf(actorId: string, scope: string, atMs: number): string[] {
    const roles = new Set<string>();
    for (const a of this.assignments.values()) {
      if (a.assigneeId === actorId && a.scope === scope && isActiveAt(a, atMs)) roles.add(a.role);
    }
    return [...roles].sort();
  }

  holds(actorId: string, role: string, scope: string, atMs: number): boolean {
    return this.rolesOf(actorId, scope, atMs).includes(role);
  }

  /** Applies one accepted event. Anything that would not validate is skipped, exactly as it was at write time. */
  applyStored(stored: StoredEvent, imported: boolean): void {
    // A peer's statement about its own people confers no local authority (ADR 0011).
    if (imported) return;
    const outcome = evaluateAssignmentEvent(this, stored.envelope, null);
    if (outcome.kind === 'grant') {
      this.assignments.set(outcome.assignment.assignmentId, {
        ...outcome.assignment,
        versions: [
          {
            eventId: stored.eventId,
            status: 'active',
            endTime: outcome.endTime,
            acceptedAt: stored.acceptedAt,
            recordedBy: outcome.assignment.issuerId,
          },
        ],
      });
    } else if (outcome.kind === 'revise') {
      const actor = (stored.envelope.payload as { actor: { actor_id: string } }).actor.actor_id;
      this.assignments.get(outcome.assignmentId)!.versions.push({
        eventId: stored.eventId,
        status: outcome.status,
        endTime: outcome.endTime,
        acceptedAt: stored.acceptedAt,
        recordedBy: actor,
      });
    }
  }

  /** Replays every event accepted since the last call. Calls are serialized. */
  async catchUp(ledger: Ledger): Promise<void> {
    const run = async () => {
      for (;;) {
        const page = await ledger.queryEvents(
          { eventTypes: ['accountability_assigned'] },
          500,
          this.lastSequence,
        );
        for (const stored of page) {
          const imported = (await ledger.getSourceReceipt(stored.eventId)) !== null;
          this.applyStored(stored, imported);
          this.lastSequence = stored.sequence;
        }
        if (page.length < 500) return;
      }
    };
    this.chain = this.chain.then(run, run);
    await this.chain;
  }
}

/**
 * Whether the assignment confers its role at `atMs`: the version in effect then
 * is active, the time is not before the grant was accepted or the stated start,
 * and it is before any end time.
 */
export function isActiveAt(a: Assignment, atMs: number): boolean {
  const granted = Date.parse(a.versions[0]!.acceptedAt);
  const effectiveFrom = Math.max(Date.parse(a.startTime), granted);
  if (atMs < effectiveFrom) return false;
  let inEffect = a.versions[0]!;
  for (const v of a.versions) {
    if (Date.parse(v.acceptedAt) <= atMs) inEffect = v;
  }
  if (inEffect.status !== 'active') return false;
  return inEffect.endTime === null || atMs < Date.parse(inEffect.endTime);
}
