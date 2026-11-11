import { text } from '../text';
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
  return [
    summary.running > 0 ? text('status.detailRunning', { count: summary.running }) : '',
    summary.needsAttention > 0 ? text('status.detailNeedAttention', { count: summary.needsAttention }) : '',
    summary.pendingQuestions > 0 ? text('status.detailPending', { count: summary.pendingQuestions }) : '',
    summary.blocked > 0 ? text('status.detailBlocked', { count: summary.blocked }) : '',
    summary.failed > 0 ? text('status.detailFailed', { count: summary.failed }) : '',
  ]
    .filter(Boolean)
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
  const parts = [
    running > 0 ? text('status.running', { count: running }) : '',
    needsAttention > 0 ? text('status.needsAttention', { count: needsAttention }) : '',
  ];
  const label = text('status.text', { parts: parts.filter(Boolean).join(' · ') });
  const isMultiRoot = projects.length > 1;
  const lines = projects.flatMap(({ name, summary }) => {
    const line = projectLine(summary);
    if (line === '') return [];
    return [isMultiRoot ? text('status.projectLine', { name, line }) : line];
  });
  return { text: label, tooltip: lines.join('\n') };
}
