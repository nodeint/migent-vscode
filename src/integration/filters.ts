/** `--file` / `--case` filters from the runner; undefined means "everything". */
export interface Filters {
  file: string | undefined;
  case: string | undefined;
}

export type WatchPass = 'poll' | 'real';

/** The pass the runner started this host for (`MIGENT_IT_WATCH`); undefined when run without a runner pass. */
export function parsePass(value: string | undefined): WatchPass | undefined {
  return value === 'poll' || value === 'real' ? value : undefined;
}

/** Lower-case a `--file` filter or suite name and drop `run`, `Scenarios` and `.integration.test(.ts)` noise. */
export function normalizeFilter(text: string | undefined): string | undefined {
  return text
    ?.toLowerCase()
    .replace(/\.integration\.test(\.ts)?$/, '')
    .replace(/^run/, '')
    .replace(/scenarios$/, '');
}

export function isFileSelected(filters: Filters, name: string): boolean {
  return filters.file === undefined || (normalizeFilter(name) ?? '').includes(filters.file);
}

/** The probe has its own cases: it runs unfiltered, or when `--file` names it (`--case` then does not narrow it). */
export function isProbeSelected(filters: Filters): boolean {
  if (filters.file === undefined) return filters.case === undefined;
  return isFileSelected(filters, 'watcherProbe');
}

/** The probe needs the real watcher: only the real pass runs it. */
export function shouldRunProbe(filters: Filters, pass: WatchPass | undefined): boolean {
  return pass !== 'poll' && isProbeSelected(filters);
}

/** The real pass is the probe alone; every other suite runs in the polling pass. */
export function shouldRunSuites(pass: WatchPass | undefined): boolean {
  return pass !== 'real';
}

/** A filter that selects no scenario and no probe is an error; only the pass that owns the selection can tell. */
export function isEmptySelection(filters: Filters, pass: WatchPass | undefined, scenarioCount: number): boolean {
  const isFiltered = filters.file !== undefined || filters.case !== undefined;
  if (!isFiltered || isProbeSelected(filters)) return false;
  return pass === 'real' ? false : scenarioCount === 0;
}
