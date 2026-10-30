/**
 * Repo root for scripts at any depth under scripts/.
 * Walks up from this file until pnpm-workspace.yaml.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * @param {string} [fromUrl]
 * @returns {string}
 */
function findRepoRoot(fromUrl = import.meta.url) {
  let dir = dirname(fileURLToPath(fromUrl));
  while (true) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find repo root (${WORKSPACE_MARKER})`);
    }
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();
