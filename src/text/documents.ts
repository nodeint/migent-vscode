/** Text of virtual documents, the timeline, extension-written output channel lines and file system errors. */
export const DOCUMENTS = {
  'documents.noEvents': () => 'No events yet.',
  'documents.sessionUnavailable': () => 'This session is not available in the open projects.',
  'documents.readOnly': () => 'This document is read-only.',
  'documents.unrecognized': ({ line }: { line: string }) => `--:--:-- [unrecognized] ${line}`,
  'documents.earlierEvents': ({ count }: { count: number }) => `… ${count} earlier events not shown`,
  'documents.doctorHeading': ({ folder }: { folder: string }) => `doctor (${folder}):`,
  'documents.doctorOk': ({ name }: { name: string }) => `ok   ${name}`,
  'documents.doctorFail': ({ name }: { name: string }) => `FAIL ${name}`,
  'documents.doctorProblem': ({ problem }: { problem: string }) => `     problem: ${problem}`,
  'documents.doctorWarning': ({ warning }: { warning: string }) => `     warning: ${warning}`,

  // Lines the extension writes to the Migent output channel
  'documents.logCompleteWarnings': ({ warnings }: { warnings: string }) => `complete warnings: ${warnings}`,
  'documents.logPrepareFailed': ({ detail }: { detail: string }) => `prepare failed: ${detail}`,
  'documents.logRepairFailed': ({ detail }: { detail: string }) => `repair failed: ${detail}`,
  'documents.logCompleteFailed': ({ detail }: { detail: string }) => `complete failed: ${detail}`,
  'documents.logRenameFailed': ({ detail }: { detail: string }) => `rename failed: ${detail}`,
  'documents.logDoctorFailed': ({ detail }: { detail: string }) => `doctor failed: ${detail}`,
  'documents.logSpawnFailed': ({ detail }: { detail: string }) => `spawn failed: ${detail}`,
  'documents.logCleanupFailed': ({ detail }: { detail: string }) => `cleanup failed: ${detail}`,

  // What `openFile` names in its not-found notice (a display label, never a path)
  'documents.kindConfig': () => 'Config',
  'documents.kindWorkflow': () => 'Workflow',
} as const;
