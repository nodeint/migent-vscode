import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Copy a fixture workspace template into a fresh temporary directory.
 * @param {string} templateDir absolute path of the template
 * @returns {string} absolute path of the copy
 */
export function copyFixtureWorkspace(templateDir) {
  const dest = mkdtempSync(join(tmpdir(), 'migent-it-'));
  cpSync(templateDir, dest, { recursive: true });
  return dest;
}
