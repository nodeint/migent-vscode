/**
 * The YAML shape of one agent (`model`, `effort`, `client.type`, `client.options`), defined once for every page that
 * edits an agent: a config `agents.<name>`, a config role's inline agent and a workflow stage's inline agent. No
 * `vscode`.
 *
 * Presence is kept: an optional field is absent (`undefined`) or present, and an empty present value is still
 * present. Keys the form does not model are kept as inert JSON in `extra` and written back unchanged.
 */
import { isRecord } from './record';

export interface OptionPair {
  key: string;
  value: string;
}

/** The `client` mapping of an agent. */
export interface ClientForm {
  type?: string;
  options?: OptionPair[];
  /** Keys of the mapping the form does not model. */
  extra: Record<string, unknown>;
}

export interface AgentForm {
  model?: string;
  effort?: string;
  client?: ClientForm;
  /** Keys of the agent mapping the form does not model. */
  extra: Record<string, unknown>;
}

export function emptyAgent(): AgentForm {
  return { extra: {} };
}

function pick(body: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!known.includes(key)) extra[key] = value;
  }
  return extra;
}

function optionPairs(value: unknown): OptionPair[] | undefined {
  if (!isRecord(value)) return undefined;
  return Object.entries(value).map(([key, item]) => ({ key, value: typeof item === 'string' ? item : String(item) }));
}

const CLIENT_KEYS = ['type', 'options'] as const;
const AGENT_KEYS = ['model', 'effort', 'client'] as const;

function parseClient(value: unknown): ClientForm {
  const body = isRecord(value) ? value : {};
  const client: ClientForm = { extra: pick(body, CLIENT_KEYS) };
  if (typeof body.type === 'string') client.type = body.type;
  const options = optionPairs(body.options);
  if (options !== undefined) client.options = options;
  return client;
}

/** Read an agent mapping from a YAML value. Anything that is not a mapping reads as an empty agent. */
export function parseAgent(value: unknown): AgentForm {
  const body = isRecord(value) ? value : {};
  const agent: AgentForm = { extra: pick(body, AGENT_KEYS) };
  if (typeof body.model === 'string') agent.model = body.model;
  if (typeof body.effort === 'string') agent.effort = body.effort;
  if (isRecord(body.client)) agent.client = parseClient(body.client);
  return agent;
}

function optionsRecord(pairs: OptionPair[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const pair of pairs) {
    if (pair.key !== '') record[pair.key] = pair.value;
  }
  return record;
}

/**
 * The mapping an agent form describes: the unmodeled keys first, then each present modeled field. A modeled key is
 * never copied from `extra`, so an edited field cannot be shadowed by a stale copy.
 */
export function agentBody(agent: AgentForm): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (agent.model !== undefined) body.model = agent.model;
  if (agent.effort !== undefined) body.effort = agent.effort;
  if (agent.client !== undefined) {
    const client: Record<string, unknown> = {};
    if (agent.client.type !== undefined) client.type = agent.client.type;
    if (agent.client.options !== undefined) client.options = optionsRecord(agent.client.options);
    for (const [key, value] of Object.entries(agent.client.extra)) {
      if (!(CLIENT_KEYS as readonly string[]).includes(key)) client[key] = value;
    }
    body.client = client;
  }
  for (const [key, value] of Object.entries(agent.extra)) {
    if (!(AGENT_KEYS as readonly string[]).includes(key)) body[key] = value;
  }
  return body;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function extraOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function clientPairs(value: unknown): OptionPair[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => ({
    key: typeof item.key === 'string' ? item.key : '',
    value: typeof item.value === 'string' ? item.value : '',
  }));
}

/** Normalize an untrusted page value into an agent form. Unknown fields are dropped; `extra` is kept as data. */
export function agentFromClient(raw: unknown): AgentForm {
  const body = isRecord(raw) ? raw : {};
  const agent: AgentForm = { extra: extraOf(body.extra) };
  const model = textOf(body.model);
  if (model !== undefined) agent.model = model;
  const effort = textOf(body.effort);
  if (effort !== undefined) agent.effort = effort;
  if (isRecord(body.client)) {
    const client: ClientForm = { extra: extraOf(body.client.extra) };
    const type = textOf(body.client.type);
    if (type !== undefined) client.type = type;
    const options = clientPairs(body.client.options);
    if (options !== undefined) client.options = options;
    agent.client = client;
  }
  return agent;
}
