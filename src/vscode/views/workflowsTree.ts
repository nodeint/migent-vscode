import path from 'node:path';

import * as vscode from 'vscode';

import { MIGENT_DIR, WORKFLOWS_DIRNAME } from '../../core/paths';
import { projectRelative, workflowRow, workflowsDiagnostic } from '../../core/projectPresentation';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { type MetaNode, MetaTreeProvider } from './projectNodes';

/**
 * Workflows view: one row per `.migent/workflows/*.{yaml,yml}` file from the project catalog.
 * Missing, empty and unreadable directories are distinct rows; an invalid file is listed by file
 * name with its error; duplicate ids are flagged on every affected file.
 */
export class WorkflowsTreeProvider extends MetaTreeProvider {
  constructor(registry: ProjectRegistry) {
    super(registry, 'workflows');
  }

  protected rows(context: ProjectContext, parent: MetaNode | undefined): MetaNode[] {
    const scan = context.catalog.workflows();
    const diagnostic = workflowsDiagnostic(scan);
    if (diagnostic !== null) {
      return [
        {
          kind: 'diag',
          id: `diag:${context.key}#${diagnostic.code}`,
          project: context.key,
          parent,
          label: diagnostic.label,
          detail: diagnostic.detail,
          isError: diagnostic.code === 'workflows-unreadable',
          contextValue: `diag.${diagnostic.code}`,
        },
      ];
    }
    return scan.entries.map((entry) => {
      const file = path.join(context.root, MIGENT_DIR, WORKFLOWS_DIRNAME, entry.file);
      return {
        kind: 'workflow',
        id: `workflow:${vscode.Uri.file(file).toString()}`,
        project: context.key,
        parent,
        file,
        view: workflowRow(entry, projectRelative(context.root, file)),
      } satisfies MetaNode;
    });
  }
}
