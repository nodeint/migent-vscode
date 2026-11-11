/** Text of the status bar item and of the transient status bar messages. */
export const STATUS = {
  'status.running': ({ count }: { count: number }) => `${count} running`,
  'status.needsAttention': ({ count }: { count: number }) => `${count} needs attention`,
  'status.text': ({ parts }: { parts: string }) => `$(sync~spin) Migent: ${parts}`,
  'status.detailRunning': ({ count }: { count: number }) => `${count} running`,
  'status.detailNeedAttention': ({ count }: { count: number }) => `${count} need attention`,
  'status.detailPending': ({ count }: { count: number }) => `${count} pending question(s)`,
  'status.detailBlocked': ({ count }: { count: number }) => `${count} blocked`,
  'status.detailFailed': ({ count }: { count: number }) => `${count} failed`,
  'status.projectLine': ({ name, line }: { name: string; line: string }) => `${name}: ${line}`,
} as const;
