import path from 'node:path';

import { text } from '../text';
import { MIGENT_DIR, WORKFLOWS_DIRNAME } from './paths';
import type { ProjectConfig } from './projectConfig';
import type { WorkflowEntry, WorkflowScan } from './workflows';

/** Text and icon of one Workflows or Project row; the host maps it to a `TreeItem`. */
export interface RowView {
  label: string;
  description?: string;
  tooltip: string;
  /** Codicon id. */
  icon: string;
  /** Theme color id for the icon. */
  color?: string;
  contextValue: string;
}

/** A non-file row explaining why the workflow list is empty or unavailable. */
export interface WorkflowsDiagnostic {
  code: 'workflows-missing' | 'workflows-empty' | 'workflows-unreadable';
  label: string;
  detail: string | null;
}

const WORKFLOWS_RELATIVE = `${MIGENT_DIR}/${WORKFLOWS_DIRNAME}`;

/** Project-relative path with forward slashes, for tooltips. */
export function projectRelative(projectRoot: string, file: string): string {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

/** Missing, empty and unreadable are distinct rows; `null` when the directory has entries. */
export function workflowsDiagnostic(scan: WorkflowScan): WorkflowsDiagnostic | null {
  switch (scan.state) {
    case 'missing':
      return { code: 'workflows-missing', label: text('views.noWorkflowsDir'), detail: text('views.workflowsDirMissing', { dir: WORKFLOWS_RELATIVE }) };
    case 'empty':
      return { code: 'workflows-empty', label: text('views.noWorkflows'), detail: text('views.workflowsEmpty', { dir: WORKFLOWS_RELATIVE }) };
    case 'unreadable':
      return { code: 'workflows-unreadable', label: text('views.workflowsUnreadable'), detail: scan.error };
    case 'ok':
      return null;
  }
}

/** A valid workflow shows its id; an invalid or unreadable one is listed by file name with its error. */
export function workflowRow(entry: WorkflowEntry, relativePath: string): RowView {
  if (entry.state !== 'ok') {
    const reason = text(entry.state === 'invalid' ? 'views.invalidWorkflow' : 'views.unreadableWorkflow');
    const error = entry.error ?? text('views.unknownError');
    return {
      label: entry.file,
      description: error.split('\n')[0],
      tooltip: text('views.workflowErrorTooltip', { reason, error, path: relativePath }),
      icon: 'error',
      color: 'list.errorForeground',
      contextValue: `workflow.${entry.state}`,
    };
  }
  const tooltip = [relativePath];
  if (entry.title !== null) tooltip.unshift(entry.title);
  if (entry.stages.length > 0) tooltip.push(text('views.workflowStages', { stages: entry.stages.join(' → ') }));
  if (entry.duplicate) {
    tooltip.push(text('views.duplicateTooltip', { id: entry.id }));
    return {
      label: entry.id,
      description: text('views.duplicateDescription', { file: entry.file }),
      tooltip: tooltip.join('\n'),
      icon: 'warning',
      color: 'list.warningForeground',
      contextValue: 'workflow.ok',
    };
  }
  return {
    label: entry.id,
    description: entry.title ?? undefined,
    tooltip: tooltip.join('\n'),
    icon: 'symbol-event',
    contextValue: 'workflow.ok',
  };
}

/** The `config.yaml` row of the Project view. A missing file is shown as unavailable, never created. */
export function configRow(config: ProjectConfig, relativePath: string): RowView {
  switch (config.state) {
    case 'ok':
      return {
        label: path.posix.basename(relativePath),
        description: config.schemaVersion === null ? undefined : text('views.configSchema', { version: String(config.schemaVersion) }),
        tooltip: relativePath,
        icon: 'settings-gear',
        contextValue: 'config.ok',
      };
    case 'missing':
      return {
        label: path.posix.basename(relativePath),
        description: text('views.configNotFound'),
        tooltip: text('views.configExpected', { path: relativePath }),
        icon: 'warning',
        color: 'list.warningForeground',
        contextValue: 'config.missing',
      };
    case 'invalid':
    case 'unreadable': {
      const error = config.error ?? text('views.unknownError');
      return {
        label: path.posix.basename(relativePath),
        description: error.split('\n')[0],
        tooltip: text(config.state === 'invalid' ? 'views.configInvalid' : 'views.configUnreadable', { error, path: relativePath }),
        icon: 'error',
        color: 'list.errorForeground',
        contextValue: `config.${config.state}`,
      };
    }
  }
}
