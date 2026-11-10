/**
 * Type-only binding for lenient parsers. No `vscode`.
 *
 * A parser still accepts `unknown` and narrows each field itself. Reading through `Wire<Contract>` ties the field
 * names it reads to the contract type, so an upstream rename is a typecheck failure here instead of a silent
 * `undefined` at runtime. Values stay `unknown`: the contract is the upper bound of what is read, not a gate.
 */
import { isRecord } from './record';

/** The keys of contract type `T` (default all of them) as they arrive over the wire: present or not, any value. */
export type Wire<T, Keys extends keyof T = keyof T> = { readonly [Key in Keys]?: unknown };

/** `value` as a record read through the contract's field names, or null when it is not an object. */
export function wireOf<T, Keys extends keyof T = keyof T>(value: unknown): Wire<T, Keys> | null {
  if (!isRecord(value)) return null;
  const wire: Wire<T, Keys> = value;
  return wire;
}
