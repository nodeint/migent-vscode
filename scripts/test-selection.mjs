import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Select configured tests by exact file or ancestor directory, never by substring. */
export function selectTests(root, paths, files) {
  const selected = new Set();
  for (const path of paths) {
    if (path.startsWith('-')) throw new Error(`Expected a test file or directory, got: ${path}`);
    const target = resolve(root, path);
    const matches = files.filter((file) => {
      const child = relative(target, resolve(root, file));
      return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
    });
    if (matches.length === 0) throw new Error(`No configured unit tests selected by: ${path}`);
    for (const file of matches) selected.add(file);
  }
  return [...selected];
}
