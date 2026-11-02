import type { AttentionSummary } from './attention';

export interface ProjectSummary {
  name: string;
  summary: AttentionSummary;
}

export interface StatusBarModel {
  text: string;
  tooltip: string;
}

function projectLine(summary: AttentionSummary): string {
  const details: [number, string][] = [
    [summary.running, 'running'],
    [summary.needsAttention, 'need attention'],
    [summary.pendingQuestions, 'pending question(s)'],
    [summary.blocked, 'blocked'],
    [summary.failed, 'failed'],
  ];
  return details
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(', ');
}

/**
 * Status bar content from per-project attention summaries; null (hidden) when nothing is
 * running and nothing needs attention. The attention part uses the badge count.
 */
export function statusBarModel(projects: readonly ProjectSummary[]): StatusBarModel | null {
  const running = projects.reduce((total, { summary }) => total + summary.running, 0);
  const needsAttention = projects.reduce((total, { summary }) => total + summary.needsAttention, 0);
  if (running === 0 && needsAttention === 0) return null;
  const parts = [running > 0 ? `${running} running` : '', needsAttention > 0 ? `${needsAttention} needs attention` : ''];
  const text = `$(sync~spin) Migent: ${parts.filter(Boolean).join(' · ')}`;
  const isMultiRoot = projects.length > 1;
  const lines = projects.flatMap(({ name, summary }) => {
    const line = projectLine(summary);
    if (line === '') return [];
    return [isMultiRoot ? `${name}: ${line}` : line];
  });
  return { text, tooltip: lines.join('\n') };
}
