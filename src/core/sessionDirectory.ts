import { readdirSync } from 'node:fs';

export interface SessionDirectoryEntry {
  name: string;
  isDirectory: boolean;
}

/** Read one level without following directory symlinks. */
export function listSessionDirectory(directory: string): SessionDirectoryEntry[] {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}
