import type {
  AuthoringEnvelope,
  Diagnostic,
  DoctorReport,
  GetClient,
  GetModel,
  GetNativeOption,
  PrepareResult,
  Static,
} from '@nodeint/migent-contracts';
import { describe, expect, it } from 'vitest';

import type { AuthoringDiagnostic, AuthoringResult } from './authoring';
import type { Expect, Same } from './contractDraft';
import type { ClientChoice, DoctorCheck, parsePrepared } from './controlArgs';
import type { EnvelopeFields, TailEvent } from './eventTail';

type Prepared = NonNullable<ReturnType<typeof parsePrepared>>;

/**
 * Compile-time only: each local result type reuses the contract's field type, so a contract change to a field the
 * extension forwards (for example `GetModel.name` becoming a number) fails `pnpm typecheck` at the parser that
 * produces it, and here.
 */
export type ForwardedFieldsMatchContract = [
  Expect<Same<ClientChoice['id'], Static<typeof GetClient>['name']>>,
  Expect<Same<ClientChoice['models'][number], Static<typeof GetModel>['name']>>,
  Expect<Same<NonNullable<ClientChoice['optionKeys']>[number], Static<typeof GetNativeOption>['name']>>,
  Expect<Same<Prepared['sessionId'], Static<typeof PrepareResult>['session_id']>>,
  Expect<Same<Prepared['taskPath'], Static<typeof PrepareResult>['task_path']>>,
  Expect<Same<DoctorCheck['name'], DoctorReport['checks'][number]['name']>>,
  Expect<Same<DoctorCheck['problems'], DoctorReport['checks'][number]['problems']>>,
  Expect<Same<AuthoringDiagnostic['severity'], Diagnostic['severity']>>,
  Expect<Same<AuthoringDiagnostic['message'], Diagnostic['message']>>,
  Expect<Same<AuthoringResult['valid'], AuthoringEnvelope['valid']>>,
  Expect<Same<AuthoringResult['currentHash'], NonNullable<AuthoringEnvelope['current_hash']> | null>>,
  // Compared only (never forwarded): controlArgs.ts types its comparison constants from these fields too.
  Expect<Same<Static<typeof GetClient>['available'], boolean>>,
  Expect<Same<Static<typeof GetModel>['default'], boolean>>,
  // Event envelope: each forwarded field keeps the contract's value type (a local `null` means absent or malformed).
  Expect<Same<NonNullable<TailEvent['seq']>, EnvelopeFields['seq']>>,
  Expect<Same<TailEvent['timestamp'], EnvelopeFields['timestamp']>>,
  Expect<Same<NonNullable<TailEvent['event']>, EnvelopeFields['event']>>,
  Expect<Same<TailEvent['data'], EnvelopeFields['data']>>,

];

describe('contract binding', () => {
  it('is checked by the compiler', () => {
    const probe: ForwardedFieldsMatchContract extends unknown[] ? true : false = true;
    expect(probe).toBe(true);
  });
});
