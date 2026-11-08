import type { ConfigScope } from './config';
import { isRecord } from './record';

const SCOPES = ['project', 'local'] as const;

const SIMPLE = ['ready', 'reload', 'openFile', 'pickModel'] as const;

/** Whether a save creates the file or replaces the one the draft was started from. Never derived by the host. */
export type SaveBase = { kind: 'replace'; hash: string } | { kind: 'create' };

export type ConfigMessage =
  | { type: 'selectTab'; tab: ConfigScope }
  | { type: (typeof SIMPLE)[number]; tab: ConfigScope }
  | { type: 'saveForm'; tab: ConfigScope; form: Record<string, unknown>; base: SaveBase };

const HASH = /^[0-9a-f]{64}$/;

function scopeOf(value: unknown): ConfigScope | null {
  return SCOPES.find((scope) => scope === value) ?? null;
}

function baseOf(value: unknown): SaveBase | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'create') return { kind: 'create' };
  if (value.kind === 'replace' && typeof value.hash === 'string' && HASH.test(value.hash)) {
    return { kind: 'replace', hash: value.hash };
  }
  return null;
}

/**
 * Validate a page message from a closed set. The page sends a tab, never a path or argv, and a save carries the
 * inert draft plus the draft's own save intent, both checked again before the CLI sees them.
 */
export function parseConfigMessage(raw: unknown): ConfigMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  const tab = scopeOf(raw.tab);
  if (tab === null) return null;
  if (raw.type === 'selectTab') return { type: 'selectTab', tab };
  const simple = SIMPLE.find((type) => type === raw.type);
  if (simple !== undefined) return { type: simple, tab };
  if (raw.type === 'saveForm') {
    const base = baseOf(raw.base);
    if (!isRecord(raw.form) || base === null) return null;
    return { type: 'saveForm', tab, form: raw.form, base };
  }
  return null;
}
