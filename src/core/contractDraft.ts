/**
 * Type-only helpers that relate an editable draft to a `@nodeint/migent-contracts` input document. No runtime code,
 * no `vscode`.
 *
 * The contracts describe valid documents. The editors write drafts: the CLI is the only validator, so a draft may omit
 * any key, including one the contract requires. A draft never converts to the contract type.
 */

/**
 * A draft of a contract object: the contract's keys with the contract's value types, every key optional, applied
 * recursively to nested objects, arrays and record values.
 */
export type Draft<T> = T extends readonly (infer Item)[]
  ? Draft<Item>[]
  : T extends object
    ? { [Key in keyof T]?: Draft<T[Key]> }
    : T;

/** Keys the extension preserves without modeling them. Their values are outside the contract guarantee. */
export interface OpenPart {
  [key: string]: unknown;
}

/** Resolves to `true` only when two key unions are the same set. Use it to pin a local key list to a contract. */
export type SameKeys<Local extends PropertyKey, Contract extends PropertyKey> = [Local] extends [Contract]
  ? [Contract] extends [Local]
    ? true
    : false
  : false;

/** Accepts only `true`, so `Expect<SameKeys<...>>` fails typecheck when the sets differ. */
export type Expect<Condition extends true> = Condition;

/** Resolves to `true` only when each type is assignable to the other. Pins a result type to a contract field type. */
export type Same<Local, Contract> = [Local] extends [Contract] ? ([Contract] extends [Local] ? true : false) : false;
