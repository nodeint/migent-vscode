import { isRecord } from './record';

/** One diagnostic from `migent workflow|config validate|save --json`, with its path as the page knows it. */
export interface AuthoringDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
  /** The layer the CLI says the diagnostic comes from (`project` or `local` for config); omitted when it names none. */
  source?: string;
  /** Whether the CLI names the draft as the cause; omitted when it says nothing. */
  draft?: boolean;
}

/** The parts of one authoring envelope the pages use. */
export interface AuthoringResult {
  valid: boolean;
  diagnostics: AuthoringDiagnostic[];
  file: string | null;
  hash: string | null;
  written: boolean;
  currentHash: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseDiagnostic(item: unknown): AuthoringDiagnostic | null {
  if (!isRecord(item)) return null;
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
export const AUTHORING_ENVELOPE_VERSION = 1;

/** Parse one `--json` authoring envelope. Malformed, unversioned or newer output is reported, never trusted. */
export function parseAuthoringEnvelope(raw: unknown): AuthoringResult | null {
  if (!isRecord(raw) || raw.schema_version !== AUTHORING_ENVELOPE_VERSION || typeof raw.valid !== 'boolean' || !Array.isArray(raw.diagnostics)) return null;
  return {
    valid: raw.valid,
    diagnostics: raw.diagnostics.map(parseDiagnostic).filter((item): item is AuthoringDiagnostic => item !== null),
    file: typeof raw.file === 'string' ? raw.file : null,
    hash: typeof raw.hash === 'string' ? raw.hash : null,
    written: raw.written === true,
    currentHash: typeof raw.current_hash === 'string' ? raw.current_hash : null,
  };
}
