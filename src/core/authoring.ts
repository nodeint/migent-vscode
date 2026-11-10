import type { AuthoringEnvelope, Diagnostic } from '@nodeint/migent-contracts';

import { wireOf } from './contractRead';

/** One diagnostic from `migent workflow|config validate|save --json`, with its path as the page knows it. */
export interface AuthoringDiagnostic {
  severity: Diagnostic['severity'];
  code: Diagnostic['code'];
  message: Diagnostic['message'];
  path: string;
  /** The layer the CLI says the diagnostic comes from (`project` or `local` for config); omitted when it names none. */
  source?: Diagnostic['source'];
  /** Whether the CLI names the draft as the cause; omitted when it says nothing. */
  draft?: Diagnostic['draft'];
}

/** The parts of one authoring envelope the pages use. */
export interface AuthoringResult {
  valid: AuthoringEnvelope['valid'];
  diagnostics: AuthoringDiagnostic[];
  file: NonNullable<AuthoringEnvelope['file']> | null;
  hash: NonNullable<AuthoringEnvelope['hash']> | null;
  written: NonNullable<AuthoringEnvelope['written']>;
  currentHash: NonNullable<AuthoringEnvelope['current_hash']> | null;
}

function text(value: unknown): Diagnostic['code']   {
  return typeof value === 'string' ? value : '';
}

function parseDiagnostic(raw: unknown): AuthoringDiagnostic | null {
  const item = wireOf<Diagnostic>(raw);
  if (item === null) return null;
  const message = text(item.message);
  if (message === '') return null;
  return {
    severity: item.severity === 'warning' ? 'warning' : 'error',
    code: text(item.code),
    message,
    path: Array.isArray(item.path) ? item.path.map(String).join('.') : '',
    ...(typeof item.source === 'string' ? { source: item.source } : {}),
    ...(typeof item.draft === 'boolean' ? { draft: item.draft } : {}),
  };
}

/** The envelope version this extension understands (`schema_version` of `--json` authoring output). */
export const AUTHORING_ENVELOPE_VERSION: AuthoringEnvelope['schema_version'] = 1;

/** Parse one `--json` authoring envelope. Malformed, unversioned or newer output is reported, never trusted. */
export function parseAuthoringEnvelope(value: unknown): AuthoringResult | null {
  const raw = wireOf<AuthoringEnvelope>(value);
  if (raw?.schema_version !== AUTHORING_ENVELOPE_VERSION) return null;
  if (typeof raw.valid !== 'boolean' || !Array.isArray(raw.diagnostics)) return null;
  return {
    valid: raw.valid,
    diagnostics: raw.diagnostics.map(parseDiagnostic).filter((item): item is AuthoringDiagnostic => item !== null),
    file: typeof raw.file === 'string' ? raw.file : null,
    hash: typeof raw.hash === 'string' ? raw.hash : null,
    written: raw.written === true,
    currentHash: typeof raw.current_hash === 'string' ? raw.current_hash : null,
  };
}
