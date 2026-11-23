import type { StorageAdapter } from '@act/ledger';
import type { LedgerContext } from './ledger-context.js';

/** The tenant used when authentication names none and `requireTenant` is off. Existing single-tenant data lives here. */
export const DEFAULT_TENANT = 'default';

/**
 * A tenant id becomes part of storage keys and log lines, so it is restricted
 * to a short, boring alphabet: no separators, no whitespace, no path syntax.
 */
export const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

/** The slice of the metadata store a tenant may touch. */
export interface MetaStore {
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  setMetaIfAbsent(key: string, value: string): Promise<boolean>;
  deleteMeta(key: string): Promise<boolean>;
  listMeta(prefix: string): Promise<{ key: string; value: string }[]>;
}

/**
 * Views the shared `ledger_meta` table through one tenant's namespace. The
 * default tenant keeps the unprefixed legacy keys, so a database created
 * before tenancy is simply the default tenant; every other tenant's keys live
 * under `tenant/<id>/`, a prefix no legacy key and no valid tenant id can
 * produce.
 */
export function scopedMeta(adapter: StorageAdapter, tenantId: string): MetaStore {
  const prefix = tenantId === DEFAULT_TENANT ? '' : `tenant/${tenantId}/`;
  return {
    getMeta: (key) => adapter.getMeta(prefix + key),
    setMeta: (key, value) => adapter.setMeta(prefix + key, value),
    setMetaIfAbsent: (key, value) => adapter.setMetaIfAbsent(prefix + key, value),
    deleteMeta: (key) => adapter.deleteMeta(prefix + key),
    listMeta: async (listPrefix) => {
      const rows = await adapter.listMeta(prefix + listPrefix);
      return (
        rows
          // The default tenant's empty prefix would otherwise also match other tenants' `tenant/...` keys.
          .filter((r) => prefix !== '' || !r.key.startsWith('tenant/'))
          .map((r) => ({ key: r.key.slice(prefix.length), value: r.value }))
      );
    },
  };
}

/**
 * Administrator entries are `actor` (administrator in whichever tenant their
 * token names) or `tenant::actor` (administrator in that tenant only). A bare
 * entry never contains `::`, so a scoped entry cannot be matched by an actor
 * whose id merely looks like one.
 */
export function isAdministrator(
  entries: readonly string[] | undefined,
  tenantId: string,
  actorId: string,
): boolean {
  if (!entries) return false;
  return entries.some((entry) => {
    const split = entry.indexOf('::');
    if (split === -1) return entry === actorId;
    return entry.slice(0, split) === tenantId && entry.slice(split + 2) === actorId;
  });
}

/** Whether `actorId` administers this context's tenant. With no administrators configured, only dev mode treats everyone as one. */
export function isAdmin(ctx: LedgerContext, actorId: string): boolean {
  const { adminActorIds, devMode } = ctx.policy;
  return adminActorIds === undefined
    ? devMode
    : isAdministrator(adminActorIds, ctx.tenantId, actorId);
}
