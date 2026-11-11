import { DOCUMENTS } from './documents';
import { PROMPTS } from './prompts';
import { SHELL } from './shell';
import { STATES } from './states';
import { STATUS } from './status';
import { VIEWS } from './views';

/**
 * The one catalog of host-written UI text. Every entry has a stable id `<area>.<name>` and is a function of typed
 * params that returns a whole sentence. `text(id, params)` is the only way to read it; a translation table keyed
 * by id can later be installed here by the host, so call sites never change.
 */
const CATALOG = { ...STATES, ...VIEWS, ...STATUS, ...DOCUMENTS, ...PROMPTS, ...SHELL } as const;

export type TextId = keyof typeof CATALOG;

type Entry<Id extends TextId> = (typeof CATALOG)[Id];

/** The params of an entry; an entry without values takes none. */
export type TextParams<Id extends TextId> = Entry<Id> extends (params: infer P) => string ? P : never;

type Args<Id extends TextId> = Entry<Id> extends () => string ? [] : [params: TextParams<Id>];

/** Method syntax makes the parameter bivariant, so every typed entry is assignable without an assertion. */
interface Loose {
  call(params?: unknown): string;
}

const ENTRIES: Record<TextId, Loose['call']> = CATALOG;

export function text<Id extends TextId>(id: Id, ...args: Args<Id>): string {
  return ENTRIES[id](args[0]);
}

export { type ActionKey, LABELS } from './labels';
export { NOTICES, PROGRESS_MESSAGES } from './notices';
