import { v7 as uuidv7, validate as validateUuid, version as uuidVersion } from 'uuid';

/** Generates a new logical identifier (UUIDv7, time-ordered) per ACT-1.0.md section 3. */
export function generateId(): string {
  return uuidv7();
}

export function isValidId(id: string): boolean {
  return validateUuid(id);
}

/** True only for UUIDv7 identifiers, the required form for newly generated ACT identities. */
export function isFreshlyGeneratedId(id: string): boolean {
  return validateUuid(id) && uuidVersion(id) === 7;
}
