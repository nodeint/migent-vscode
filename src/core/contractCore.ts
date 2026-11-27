/**
 * Core contract types. Contracts 0.10.1 build `InlineAgent`, `RoleEntry`, `WorkflowStage` and the workflow document
 * with plugin-claimed keys added through `Record<string, TSchema>`, so `Static` of them loses every known key. The
 * `*_CORE_PROPERTIES` maps are plain, so the core keys are typed from those. Plugin-claimed keys (`plugins`,
 * `prompt_cache_ttl`) are tied to the contract at runtime by `contractCore.test.ts`. Type-only, no `vscode`.
 */
import type {
  AGENT_CORE_PROPERTIES,
  ConfigLayer,
  ROLE_CORE_PROPERTIES,
  STAGE_CORE_PROPERTIES,
  Static,
  TObject,
  WORKFLOW_CORE_PROPERTIES,
} from '@nodeint/migent-contracts';

/** An agent's core keys, all optional (a named fragment or an inline agent). */
export type CoreAgent = Static<TObject<typeof AGENT_CORE_PROPERTIES>>;
/** A role's core keys. */
export type CoreRole = Static<TObject<typeof ROLE_CORE_PROPERTIES>>;
/** A stage's core keys. */
export type CoreStage = Static<TObject<typeof STAGE_CORE_PROPERTIES>>;
/** A workflow document's core keys; its stages are core stages (the contract's own `stages` item type is collapsed). */
export type CoreWorkflow = Omit<Static<TObject<typeof WORKFLOW_CORE_PROPERTIES>>, 'stages'> & { stages?: CoreStage[] };
/** A config layer's core keys (without the plugin-claimed `plugins`). */
export type CoreConfig = Pick<Static<typeof ConfigLayer>, 'schema_version' | 'agents' | 'roles'>;
