import { configPath } from '../../core/paths';
import { configRow, projectRelative } from '../../core/projectPresentation';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { type MetaNode, MetaTreeProvider } from './projectNodes';

/** Project view: the project's `.migent/config.yaml` as one row; a missing file is unavailable, never created. */
export class ProjectTreeProvider extends MetaTreeProvider {
  constructor(registry: ProjectRegistry) {
    super(registry, 'config');
  }

  protected rows(context: ProjectContext, parent: MetaNode | undefined): MetaNode[] {
    const file = configPath(context.root);
    return [
      {
        kind: 'config',
        id: `config:${context.key}`,
        project: context.key,
        parent,
        file,
        view: configRow(context.catalog.config(), projectRelative(context.root, file)),
      },
    ];
  }
}
