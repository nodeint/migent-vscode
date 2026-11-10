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

/**
 * The keys of contract type `T` with the contract's own value types, present or not. For readers whose result type
 * forwards a contract field: a contract change of a field's type breaks the reader that narrows it. The value is
 * still checked at runtime; this is a drift signal, never a validation gate.
 */
export type Declared<T, Keys extends keyof T = keyof T> = { readonly [Key in Keys]?: T[Key] };

/** `value` as a record read through the contract's field names and value types, or null when it is not an object. */
export function declaredOf<T, Keys extends keyof T = keyof T>(value: unknown): Declared<T, Keys> | null;
// The overload is the one place the contract's value types are declared; every reader still verifies them at runtime.
export function declaredOf(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
