/**
 * The Configuration page's data: `.migent/config.yaml` and `.migent/config.local.yaml` as inert form data, the page
 * draft normalized back from untrusted JSON, and the YAML draft `migent config save` receives. No `vscode`.
 *
 * Presence is kept (an optional field is absent or present, and an empty value is still present) and keys the form does
 * not model travel in `extra` at every rebuilt mapping, so a save changes only what the user edited.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { ConfigLayer, InlineAgent, NamedAgentFragment, RoleEntry as ContractRoleEntry, Static } from '@nodeint/migent-contracts';
import { parse, stringify } from 'yaml';

import { agentBody, type AgentDraft, type AgentForm, agentFromClient, emptyAgent, parseAgent } from './agentForm';
import type { Draft, Expect, OpenPart, Same, SameKeys } from './contractDraft';
import { wireOf } from './contractRead';
import type { ClientChoice } from './controlArgs';
import { configLocalPath, configPath } from './paths';
import { isRecord } from './record';

/**
 * The config schema version this extension writes. Gap: the contract types `schema_version` as a plain `number`, so
 * this value cannot be bound to the contract at compile time; a bump upstream is caught only by the CLI at save time.
 */
export const CONFIG_SCHEMA_VERSION = 7;

export type ConfigScope = 'project' | 'local';

export type RoleAgent =
  | { mode: 'absent' }
  | { mode: 'named'; name: string }
  | { mode: 'inline'; agent: AgentForm };

export interface AgentEntry {
  name: string;
  agent: AgentForm;
}

export interface RoleEntry {
  name: string;
  description?: string;
  responsibilities?: string[];
  agent: RoleAgent;
  extra: Record<string, unknown>;
}

export interface ConfigForm {
  schemaVersion: number | null;
  agents: AgentEntry[];
  roles: RoleEntry[];
  extra: Record<string, unknown>;
}

export type ConfigTabState = 'ok' | 'missing' | 'invalid' | 'unreadable' | 'unsupported';

export interface ConfigValidation {
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

/** A diagnostic the page shows. `file` is set when it comes from the other layer's file. */
export interface ConfigIssue {
  path: string;
  message: string;
  file?: string;
}

export interface ConfigTabModel {
  scope: ConfigScope;
  /** The file name, for labels. */
  file: string;
  path: string;
  state: ConfigTabState;
  exists: boolean;
  hash: string;
  schemaVersion: number | null;
  readError: string | null;
  form: ConfigForm;
  canSave: boolean;
  validation: ConfigValidation;
}

export interface ConfigModel {
  project: string;
  /** The tab the page shows first (and the one a reloaded window restores). */
  tab: ConfigScope;
  tabs: Record<ConfigScope, ConfigTabModel>;
  /** Available clients with their models and native option keys; empty when the CLI cannot list them. */
  clients: ClientChoice[];
  /** Agent names of the effective config: both files' `agents` keys. */
  agentNames: string[];
}

export function emptyConfigForm(): ConfigForm {
  return { schemaVersion: CONFIG_SCHEMA_VERSION, agents: [], roles: [], extra: {} };
}

export const CONFIG_FILES: Record<ConfigScope, string> = { project: 'config.yaml', local: 'config.local.yaml' };

/** What the CLI merges as one piece on the Local tab (docs: `config.md`). The page reads this one table. */
export const MERGE_UNITS = {
  agent: ['model', 'effort', 'client.type', 'client.options.<key>'],
  role: ['description', 'responsibilities', 'agent'],
} as const;

const ROLE_KEYS = ['description', 'responsibilities', 'agent'] as const satisfies readonly (keyof ContractRoleEntry)[];
const ROOT_KEYS = ['schema_version', 'agents', 'roles'] as const satisfies readonly (keyof ConfigLayer)[];

// A key added to or removed from the contract's role or config layer fails typecheck here.
export type ConfigKeysMatchContract = [
  Expect<SameKeys<(typeof ROLE_KEYS)[number], keyof ContractRoleEntry>>,
  Expect<SameKeys<(typeof ROOT_KEYS)[number], keyof ConfigLayer>>,
];

/** The contract's role `agent`: a named-agent reference (string) or an inline agent. */
type ContractRoleAgent = NonNullable<ContractRoleEntry['agent']>;
/** The contract's `agents.<name>` and `roles.<name>` entries. */
type ContractNamedAgent = NonNullable<ConfigLayer['agents']>[string];
type ContractFragment = Static<typeof NamedAgentFragment>;
type ContractRole = NonNullable<ConfigLayer['roles']>[string];

/** What `roleBody` writes for a role: the contract's keys (all optional), an agent name or draft, plus extras. */
export type RoleDraft = Draft<Omit<ContractRoleEntry, 'agent'>> & {
  agent?: Extract<ContractRoleAgent, string> | AgentDraft;
} & OpenPart;

/** What `configBodyFromForm` writes: a draft of a `ConfigLayer`, never asserted to be a valid one. */
export type ConfigDraft = Draft<Omit<ConfigLayer, 'agents' | 'roles'>> & {
  agents?: { [name: string]: AgentDraft };
  roles?: { [name: string]: RoleDraft };
} & OpenPart;

// The replaced members (`agent`, `agents`, `roles`) stay tied to the contract: a change to their shape fails typecheck.
export type ReplacedMembersMatchContract = [
  Expect<Same<ContractRole, ContractRoleEntry>>,
  Expect<Same<Extract<ContractRoleAgent, string>, string>>,
  Expect<SameKeys<keyof Exclude<ContractRoleAgent, string>, keyof InlineAgent>>,
  Expect<Same<Exclude<ContractRoleAgent, string>['effort'], InlineAgent['effort']>>,
  Expect<Same<Exclude<ContractRoleAgent, string>['client'], InlineAgent['client']>>,
  Expect<SameKeys<keyof ContractNamedAgent, keyof ContractFragment>>,
  Expect<SameKeys<keyof ContractNamedAgent, keyof InlineAgent>>,
  Expect<Same<ContractNamedAgent['effort'], InlineAgent['effort']>>,
  Expect<Same<ContractNamedAgent['client'], InlineAgent['client']>>,
  Expect<Same<ContractNamedAgent, ContractFragment>>,
];

function without(body: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !known.includes(key)));
}

function textList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function roleAgent(value: unknown): RoleAgent {
  if (typeof value === 'string') return { mode: 'named', name: value };
  if (isRecord(value)) return { mode: 'inline', agent: parseAgent(value) };
  return { mode: 'absent' };
}

function roleEntry(name: string, value: unknown): RoleEntry {
  const body = isRecord(value) ? value : {};
  const wire = wireOf<ContractRoleEntry>(value) ?? {};
  const role: RoleEntry = { name, agent: roleAgent(wire.agent), extra: without(body, ROLE_KEYS) };
  if (typeof wire.description === 'string') role.description = wire.description;
  const responsibilities = textList(wire.responsibilities);
  if (responsibilities !== undefined) role.responsibilities = responsibilities;
  return role;
}

/** Project a parsed config mapping into the form. */
export function configFormFromBody(body: Record<string, unknown>): ConfigForm {
  const wire = wireOf<ConfigLayer>(body) ?? {};
  const version = wire.schema_version;
  return {
    schemaVersion: typeof version === 'number' && Number.isFinite(version) ? version : null,
    agents: isRecord(wire.agents)
      ? Object.entries(wire.agents).map(([name, value]) => ({ name, agent: parseAgent(value) }))
      : [],
    roles: isRecord(wire.roles) ? Object.entries(wire.roles).map(([name, value]) => roleEntry(name, value)) : [],
    extra: without(body, ROOT_KEYS),
  };
}

/** SHA-256 of the raw bytes, the base hash `config save` compares. */
export function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const EMPTY_VALIDATION: ConfigValidation = { errors: [], warnings: [] };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function tabBase(scope: ConfigScope): Pick<ConfigTabModel, 'scope' | 'file' | 'path' | 'validation'> {
  const file = CONFIG_FILES[scope];
  return { scope, file, path: `.migent/${file}`, validation: EMPTY_VALIDATION };
}

/** Read one config file for the page. A missing file is reported; it is created only by a save. */
export function readConfigTab(projectRoot: string, scope: ConfigScope): ConfigTabModel {
  const base = tabBase(scope);
  const filePath = scope === 'project' ? configPath(projectRoot) : configLocalPath(projectRoot);
  const failed = (state: ConfigTabState, readError: string, hash: string): ConfigTabModel => ({
    ...base,
    state,
    exists: true,
    hash,
    schemaVersion: null,
    readError,
    form: emptyConfigForm(),
    canSave: false,
  });
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return {
        ...base,
        state: 'missing',
        exists: false,
        hash: '',
        schemaVersion: CONFIG_SCHEMA_VERSION,
        readError: null,
        form: emptyConfigForm(),
        // A draft started from this file may be saved after the file vanished; the host decides create or replace.
        canSave: true,
      };
    }
    return { ...failed('unreadable', errorText(error), ''), exists: false };
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return failed('invalid', errorText(error), hashOf(text));
  }
  parsed ??= {};
  if (!isRecord(parsed)) return failed('invalid', `${CONFIG_FILES[scope]} must be a YAML mapping`, hashOf(text));
  const form = configFormFromBody(parsed);
  const isSupported = form.schemaVersion === CONFIG_SCHEMA_VERSION;
  return {
    ...base,
    state: isSupported ? 'ok' : 'unsupported',
    exists: true,
    hash: hashOf(text),
    schemaVersion: form.schemaVersion,
    readError: null,
    form,
    canSave: isSupported,
  };
}

/** The agent names of the effective config. */
export function effectiveAgentNames(...forms: ConfigForm[]): string[] {
  const names: string[] = [];
  for (const form of forms) {
    for (const entry of form.agents) {
      if (!names.includes(entry.name)) names.push(entry.name);
    }
  }
  return names;
}

// ---------- the page's draft, treated as inert data ----------

function clientRole(raw: unknown): RoleEntry {
  const body = isRecord(raw) ? raw : {};
  const agent = isRecord(body.agent) ? body.agent : {};
  let selection: RoleAgent = { mode: 'absent' };
  if (agent.mode === 'named') selection = { mode: 'named', name: typeof agent.name === 'string' ? agent.name : '' };
  else if (agent.mode === 'inline') selection = { mode: 'inline', agent: agentFromClient(agent.agent) };
  const role: RoleEntry = {
    name: typeof body.name === 'string' ? body.name : '',
    agent: selection,
    extra: isRecord(body.extra) ? { ...body.extra } : {},
  };
  if (typeof body.description === 'string') role.description = body.description;
  const responsibilities = textList(body.responsibilities);
  if (responsibilities !== undefined) role.responsibilities = responsibilities;
  return role;
}

/** Normalize an untrusted page draft into the form shape. Unknown fields are dropped, never executed. */
export function configFormFromClient(raw: unknown): ConfigForm {
  const body = isRecord(raw) ? raw : {};
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  return {
    schemaVersion: typeof body.schemaVersion === 'number' && Number.isFinite(body.schemaVersion) ? body.schemaVersion : null,
    agents: list(body.agents).filter(isRecord).map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      agent: agentFromClient(item.agent),
    })),
    roles: list(body.roles).map(clientRole),
    extra: isRecord(body.extra) ? { ...body.extra } : {},
  };
}

// ---------- the YAML draft the CLI saves ----------

function roleBody(role: RoleEntry): RoleDraft {
  const body: RoleDraft = {};
  if (role.description !== undefined) body.description = role.description;
  if (role.responsibilities !== undefined) body.responsibilities = role.responsibilities;
  if (role.agent.mode === 'named') body.agent = role.agent.name;
  if (role.agent.mode === 'inline') body.agent = agentBody(role.agent.agent);
  for (const [key, value] of Object.entries(role.extra)) {
    if (!(ROLE_KEYS as readonly string[]).includes(key)) body[key] = value;
  }
  return body;
}

/**
 * The mapping the form describes. On the Local overlay an entry with nothing present is not written, since it would
 * only be an empty override; on Project every entry is written as it is.
 */
export function configBodyFromForm(form: ConfigForm, scope: ConfigScope): ConfigDraft {
  const body: ConfigDraft = {};
  if (form.schemaVersion !== null) body.schema_version = form.schemaVersion;
  for (const [key, value] of Object.entries(form.extra)) {
    if (!(ROOT_KEYS as readonly string[]).includes(key)) body[key] = value;
  }
  const isKept = (entry: object): boolean => scope === 'project' || Object.keys(entry).length > 0;
  const agents: Record<string, AgentDraft> = {};
  for (const entry of form.agents) {
    const agent = agentBody(entry.agent);
    if (isKept(agent)) agents[entry.name] = agent;
  }
  if (Object.keys(agents).length > 0 || scope === 'project') body.agents = agents;
  const roles: Record<string, RoleDraft> = {};
  for (const role of form.roles) {
    const entry = roleBody(role);
    if (isKept(entry)) roles[role.name] = entry;
  }
  if (Object.keys(roles).length > 0 || scope === 'project') body.roles = roles;
  return body;
}

/** A name used twice would silently drop the earlier entry in a mapping keyed by name; refused before serializing. */
export function duplicateNameProblem(form: ConfigForm): string | null {
  for (const [label, names] of [
    ['agent', form.agents.map((item) => item.name)],
    ['role', form.roles.map((item) => item.name)],
  ] as const) {
    if (names.some((name) => name === '')) return `Every ${label} needs a name.`;
    const repeated = names.find((name, index) => names.indexOf(name) !== index);
    if (repeated !== undefined) return `The ${label} name "${repeated}" is used more than once.`;
  }
  return null;
}

/** The canonical YAML sent to `migent config save -`; `--preserve-comments` keeps the target's layout. */
export function configDraftFromForm(form: ConfigForm, scope: ConfigScope): string {
  return stringify(configBodyFromForm(form, scope), { lineWidth: 0 });
}

export { emptyAgent };
