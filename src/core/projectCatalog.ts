import type { ProjectChangeEvent } from './model';
import { type ProjectConfig, readProjectConfig } from './projectConfig';
import { Emitter } from './store';
import {
  isWorkflowFile,
  markDuplicates,
  readWorkflowFile,
  scanWorkflows,
  type WorkflowScan,
} from './workflows';

const EMPTY_SCAN: WorkflowScan = { state: 'missing', error: null, entries: [] };
const UNLOADED_CONFIG: ProjectConfig = { state: 'missing', error: null, schemaVersion: null };

/**
 * Project metadata that is not a session: workflow files and `config.yaml`. Kept
 * apart from `SessionStore` so a workflow or config edit never reloads sessions.
 * Emits only when the re-read value differs from the cached one.
 */
export class ProjectCatalog {
  public readonly projectRoot: string;

  readonly #changes = new Emitter<ProjectChangeEvent>();
  #workflows: WorkflowScan = EMPTY_SCAN;
  #config: ProjectConfig = UNLOADED_CONFIG;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  public get onDidChange(): (listener: (event: ProjectChangeEvent) => void) => () => void {
    return (listener) => this.#changes.subscribe(listener);
  }

  public workflows(): WorkflowScan {
    return this.#workflows;
  }

  public config(): ProjectConfig {
    return this.#config;
  }

  /** Full reload of every workflow file and the config. */
  public load(): void {
    this.#setWorkflows(scanWorkflows(this.projectRoot));
    this.reloadConfig();
  }

  /** Re-read one workflow file by name; a vanished file is dropped. Other files are untouched. */
  public reloadWorkflow(file: string): void {
    if (!isWorkflowFile(file)) return;
    const current = this.#workflows;
    // Without a readable directory scan there is nothing to patch; do a full scan.
    if (current.state === 'missing' || current.state === 'unreadable') {
      this.#setWorkflows(scanWorkflows(this.projectRoot));
      return;
    }
    const rest = current.entries.filter((entry) => entry.file !== file);
    const entry = readWorkflowFile(this.projectRoot, file);
    const entries = markDuplicates(entry === null ? rest : [...rest, entry]);
    this.#setWorkflows({ state: entries.length === 0 ? 'empty' : 'ok', error: null, entries });
  }

  public reloadConfig(): void {
    const next = readProjectConfig(this.projectRoot);
    if (JSON.stringify(next) === JSON.stringify(this.#config)) return;
    this.#config = next;
    this.#changes.emit({ project: this.projectRoot, kind: 'config' });
  }

  #setWorkflows(next: WorkflowScan): void {
    if (JSON.stringify(next) === JSON.stringify(this.#workflows)) return;
    this.#workflows = next;
    this.#changes.emit({ project: this.projectRoot, kind: 'workflows' });
  }
}
