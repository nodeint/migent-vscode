import { readFileSync } from 'node:fs';

import { isRecord } from './record';

const LINE_BREAK = /[\n\r]/;

/** Why a title is not acceptable, or null. Mirrors the CLI: reject line breaks in the raw value, then empty. */
export function validateRenameTitle(raw: string): string | null {
  if (LINE_BREAK.test(raw)) return 'The title must be a single line.';
  if (raw.trim() === '') return 'The title must not be empty.';
  return null;
}

/** The trimmed title of a valid rename input, or null. */
export function normalizeRenameTitle(raw: string): string | null {
  return validateRenameTitle(raw) === null ? raw.trim() : null;
}

/** Title from parsed `title.json` content: a non-empty single-line string, else null. History is not read. */
export function parseTitleRecord(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.title !== 'string') return null;
  const title = parsed.title.trim();
  return title === '' || LINE_BREAK.test(parsed.title) ? null : title;
}

/** Read `title.json`. Null when missing, unreadable or invalid; never throws. */
export function readTitleOverride(titleFilePath: string): string | null {
  try {
    return parseTitleRecord(readFileSync(titleFilePath, 'utf8'));
  } catch {
    return null;
  }
}
