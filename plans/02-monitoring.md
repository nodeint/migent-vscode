# Phase 2: Monitoring (read-only MVP)

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`01-core.md`](./01-core.md).
Next: [`03-control.md`](./03-control.md).

This file is the implementation plan for phase 2. It follows the design principles and contract table in
[`vscode-extension.md`](./vscode-extension.md) and does not change their scope. Conflicts with other plan files are
listed in [§10](#10-conflicts-with-other-plan-files) rather than resolved silently.

## 1. Outcome and scope

**Outcome.** A developer who opens a workspace containing one or more Migent projects can see every session's
state, follow running sessions live, inspect executions, outputs, pending human questions, downstream suggestions
and lineage, and open project config and workflow files in native editors. Nothing in this phase issues a CLI
write or writes to `.migent/`.

**In scope.** Activation; multi-root project discovery; file watcher (preceded by a watcher spike, S0); Sessions,
Workflows and Project trees; welcome content; status bar; file-opening commands; aggregated timeline document;
per-session Output Channel; read-only Results overview with downstream suggestion metadata and observed lineage;
read-only pending human questions and history; CLI version check; the settings and commands listed in
[§6.9](#69-settings-and-commands); the repository tooling approved for this phase (ESLint import rule,
`@vscode/test-electron` integration layer).

**Non-goals.** CLI write operations (run, continue, prepare, cancel, answer, repair, regenerate suggestions); the
interactive Next step page ([`03b-downstream-handoff.md`](./03b-downstream-handoff.md)); the question answer form,
drafts and fingerprints ([`03a-human-input.md`](./03a-human-input.md)); notifications; `metrics.json`; workflow
graph and dashboards (phase 5); `migent session list --json` reconciliation; nested projects below a workspace
folder root; asynchronous readers.

**Deferred from phase 2 (follow-ups).** Each is cut to keep the phase proportional; none is needed for correctness.

| Item | Reason | Phase 2 behavior instead | Owner of follow-up |
| :--- | :--- | :--- | :--- |
| Detail cache in the store (cached executions, questions, outputs, next, lineage with invalidation, interest counting and eviction) | A cache needs a dependency table, derived invalidation and a release policy, and it can disagree with disk; the store was thinned to snapshots instead (decided) | Consumers read the file on demand with stateless readers and re-read when told a file changed (§6.2) | Revisit only if the S11 budget (§8, AC22) shows repeated reads are noticeable |
| Lineage resolution for sessions outside the retention limit | Requires an index over unretained sessions and on-demand reads; 3b already plans it | Only relations among retained sessions are shown; a child whose source is hidden shows the source id as text with a Show-more hint | [`03b-downstream-handoff.md`](./03b-downstream-handoff.md#9-lineage-snapshots-and-view-state) (see C8) |
| npm `.cmd` shim parsing | Parsing an undocumented shim format is fragile; the development machine has a native `migent.exe` | `.cmd`, `.bat`, `.ps1` targets are `unsupported` with an instruction (§5.5) | Later phase, if users report npm installs |

**Architectural constraints** (from [`vscode-extension.md`](./vscode-extension.md#1-design-principles)):
native UI first, files are the source of truth, `core/` never imports `vscode`, refuse to guess on unknown
versions, no `@nodeint/migent-kernel`, data flows **watcher → store → view** and views never read disk. Core readers
stay synchronous in this phase (decided); performance is bounded by the budget in §6.5 and checked in S11.

## 2. Current state

### Verified facts

- [`src/extension.ts`](../src/extension.ts) registers `migent.refresh` with an empty handler; nothing else is
  activated. [`package.json`](../package.json) contributes only that command, activates on
  `workspaceContains:.migent/config.yaml`, declares `extensionKind: ["workspace"]` and `engines.vscode ^1.90.0`.
- `src/core/` contains `paths`, `manifest`, `statusReader`, `lockProbe`, `displayState`, `eventTail`,
  `executions`, `workflows`, `model`, `record`, `store`, colocated tests and fixtures under
  [`src/core/fixtures`](../src/core/fixtures) (sessions: active-stopped, blocked, cancelled, completed,
  corrupt-status, failed, prepared, running, stale-lock, unknown-schema; two workflows).
- `questions.ts`, `questionAnswers.ts`, `nextWorkflows.ts` and `handoff.ts`, listed as phase 1 deliverables in
  [`01-core.md`](./01-core.md#scope), **do not exist**. There is no question, outputs, next, config or lineage
  reader, and no `question` display state.
- `deriveDisplayState` ([`displayState.ts`](../src/core/displayState.ts)) returns `unknown` for a status error, a
  missing status or an unsupported schema without recording which; the reason is lost before the view.
- `SessionStore` ([`store.ts`](../src/core/store.ts)) is one project per instance, synchronous, with no watcher;
  emits `{project, sessionId, kind}` with kinds `added | updated | removed`. `load()` reads every session
  directory, then discards snapshots beyond `limit` (readonly, default 50). The store holds snapshots only: the
  executions cache and the event offset were removed from it (decided, §6.2); `listExecutions` is called by the
  consumer and `EventTail` ([`eventTail.ts`](../src/core/eventTail.ts)) owns offset and seq watermark per file.
- `listWorkflows` ([`workflows.ts`](../src/core/workflows.ts)) silently skips unreadable or invalid YAML and returns
  `[]` on a directory error; `SessionStore.listSessionIds` also returns `[]` on a directory error. Missing,
  empty and unreadable are therefore indistinguishable today.
- `tailEvents` keeps the offset when the file shrinks; nothing detects truncation.
- `readStatus` retries with a synchronous `Atomics.wait` sleep (up to 200 ms per corrupt file) — on the extension
  host this blocks the thread. `SessionStatus.raw` ([`model.ts`](../src/core/model.ts)) keeps the whole parsed
  `status.json`, including `latest_provider_event`.
- `SUPPORTED_MANIFEST_SCHEMA_VERSIONS` in [`model.ts`](../src/core/model.ts) is defined as
  `[1, KNOWN_EVENT_VERSION]`, coupling manifest support to the event envelope version.
- [`vitest.config.ts`](../vitest.config.ts) includes only `src/core/**/*.test.ts`. No `@vscode/test-electron`
  harness exists; [`docs/testing.md`](../docs/testing.md) states extension-host integration tests are not
  configured. [`eslint.config.mjs`](../eslint.config.mjs) has no rule preventing `vscode` imports in `core/`; it
  already names `**/*.integration.test.ts` among test globs and ignores `**/fixtures/**`.
- [CI](../.github/workflows/ci.yml) runs `typecheck`, `build`, `test` and `package` on `ubuntu-latest` and
  `windows-latest`; it does **not** run `pnpm lint` (see Q1).
- The installed CLI on the development machine reports `migent --version` → `0.3.1` and is a native `migent.exe`.

### Observed upstream shapes (CLI 0.3.1)

Real files written by `migent` 0.3.1, redacted, are in [`src/core/fixtures/captured/`](../src/core/fixtures/captured)
(see its [`README.md`](../src/core/fixtures/captured/README.md)). They close the former contract gate G-A. Readers
validate these shapes; they are no longer "lenient / unconfirmed".

- **`status.json.questions[]`**
  ([`question-pending/status.json`](../src/core/fixtures/captured/question-pending/status.json)): records with
  `id, question, context, selection, options[{id, label, description?}], recommended?, execution_id, stage_id,
  recipient, file`. No `status` or `answer`. The key is present only while questions are pending; it is absent
  after the reply ([`question-answered/status.json`](../src/core/fixtures/captured/question-answered/status.json)).
- **Session `questions.json`**
  ([`question-pending/questions.json`](../src/core/fixtures/captured/question-pending/questions.json),
  [`question-answered/questions.json`](../src/core/fixtures/captured/question-answered/questions.json)):
  `schema_version: 1`, `questions[]` with the same fields as above minus `file`, plus `status`
  (`pending | answered | superseded`), `answer` (`null`, `{question_id, selected[]}` or
  `{question_id, selected: [], text}`) and `answered_at`.
- **Execution `questions.json`**
  ([`question-pending/executions/0001-planner--attempt-01/questions.json`](../src/core/fixtures/captured/question-pending/executions/0001-planner--attempt-01/questions.json)):
  header `schema_version, stage_id, execution_id, recipient` and records without `status`/`answer`; unchanged after
  the reply. Phase 2 lists and opens it as a file and does not parse it.
- **`next.json` v1** ([`handoff-source/next.json`](../src/core/fixtures/captured/handoff-source/next.json)):
  `{schema_version, source_session_id, next[{workflow, task, artifacts{name: {output, path}}, argv}]}`; `path` is
  relative to the source session directory.
- **`status.json.outputs`** ([`handoff-source/status.json`](../src/core/fixtures/captured/handoff-source/status.json)):
  `name → {path, source_execution_id, published_by_execution_id}`.
- **Target manifest and status**
  ([`handoff-target/manifest.yaml`](../src/core/fixtures/captured/handoff-target/manifest.yaml),
  [`handoff-target/status.json`](../src/core/fixtures/captured/handoff-target/status.json)): `prior_session_id` and
  `handoff {source_session_id, artifacts{name: {output, source_path, path, sha256}}}`. `source_path` is absolute and
  machine-specific: it is never opened or shown as a link. `path` is `handoff/<n>/<file>`, relative to the target
  session directory. In the manifest, `handoff` is inline JSON inside the YAML (a flow mapping). `status.json`
  repeats the same mapping. Manifest `schema_version` is `2`.
- **`latest_provider_event`** can be very large (`details.argv`, `usage`). The captured samples are redacted to
  `details: {}`, so size is not visible there; readers keep only its small scalar fields (`event`, `summary`,
  `stage_id`, `execution_id`, `provider`, `timestamp`) and never retain or render the full object.
- **Still unobserved** (readers stay lenient for these and mark them unverified in tests):
  - a `superseded` question record (shape of `answer`/`answered_at` unknown);
  - a Running or Blocked workflow session that also has pending questions (fixtures for these are synthetic);
  - the frozen workflow `downstream` declaration in `workflow.frozen.yaml` (not part of the captured set).

### Baseline checks (2026-11-01, branch `chore/split-monitoring-plan`)

Recorded by the previous planning pass; not re-run for this revision.

| Command | Result |
| :--- | :--- |
| `pnpm test` | Pass (vitest suite and `node --test scripts/*.test.mjs`: 9/9) |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm build` | Pass |
| `pnpm lint:md` | **Fails (pre-existing)**: `designs/README.md` MD013, `README.md` MD040. `plans/**` is excluded. |

`src/core/fixtures/captured/` is untracked in the working tree; it must be committed with the first slice that
tests against it (S2).

## 3. Gap analysis

"Core" means `src/core/` (no `vscode` import, vitest). "Host" means the new VS Code layer.

| # | Gap | Needed for | Owner |
| :--- | :--- | :--- | :--- |
| G1 | `question` display state and icon (`comment-discussion`), rule order per [`01-core.md`](./01-core.md#1-displayed-state); an `unknownReason` (`missing-status`, `unreadable-status`, `invalid-status`, `unsupported-schema`, `invalid-manifest`, `unrecognized-status`) carried with Unknown | Sessions tree, attention, Unknown reason | Core: [`displayState.ts`](../src/core/displayState.ts), [`model.ts`](../src/core/model.ts) |
| G2 | Decouple manifest supported versions from `KNOWN_EVENT_VERSION` | Unknown-schema handling | Core: `model.ts` |
| G3 | Filenames/paths for `questions.json`, `next.json`, `workflow.frozen.yaml`, `task.md`, `outputs/`, `handoff/`, `cancel.requested`, `.migent/config.yaml` | All readers, watcher routing | Core: [`paths.ts`](../src/core/paths.ts) |
| G4 | Scan outcome that distinguishes missing / empty / unreadable sessions directory, and separates **discovered directories** (every child directory of `sessions/`) from **eligible sessions** (directories with `manifest.yaml` or `status.json`, the current `listSessionIds` rule); markerless directories are reported as pending | Welcome vs. error; watching session directories before their markers exist | Core: `store.ts` |
| G5 | Workflow entries with `ok`/`invalid`/`unreadable` state, error text, duplicate-id diagnostic; single-file re-read | Workflows tree | Core: `workflows.ts` (changed) |
| G6 | `.migent/config.yaml` reader: `missing`/`ok`/`invalid`/`unreadable` and raw `schema_version` | Project tree | Core: **new** `projectConfig.ts` |
| G7 | Project metadata holder for workflows and config with its own change events | Workflow/config refresh without session reload | Core: **new** `projectCatalog.ts` |
| G8 | Pending question summary from `status.json.questions` (observed shape, §2); lazy session `questions.json` history with `missing`/`ok`/`invalid`/`unsupported`; lenient `superseded` | Questions node, attention | Core: `statusReader.ts` (changed), **new** `questions.ts` (read side only) |
| G8a | Status reader keeps only small fields of `latest_provider_event` and does not retain it in `raw` | Memory, tooltips | Core: `statusReader.ts`, `model.ts` |
| G9 | Published outputs from `status.json.outputs` plus path-only rows for unnamed files in `outputs/`; paths confined to the session directory | Outputs node, Results | Core: **new** `outputs.ts` |
| G10 | `next.json` v1 reader (observed shape) and lenient frozen `downstream` reader; per-suggestion `declared` flag | Results suggestions | Core: **new** `nextWorkflows.ts` (read side only) |
| G11 | Lineage among retained sessions: pure `childrenOf(snapshots, sessionId)` over the retained snapshots' `prior_session_id` (nothing cached); `handoff` parse of the observed shape (inline JSON in YAML), local `path` confined to the target session, `source_path` kept as text only | Results lineage, child → source link | Core: **new** `handoff.ts` (read side only) |
| G12 | Stateless detail readers and watch interest: no detail cache in the store; consumers call the readers on demand and re-read when the watcher reports a changed file; watcher interest (not data) decides which detail folders are watched | Watcher, trees, Results | Host: `watcher.ts`; readers in core |
| G12a | Execution file discovery: stateless `listExecutionFiles` reporting `prompt.md`, `task.md`, `response.md`, `questions.json`, `stream.jsonl`, `turns/*/verify.md` and the `artifacts/` listing, called when an execution node is expanded | Execution children in Sessions tree | Core: **new** `executionFiles.ts` |
| G13 | Per-file tail state outside the store: `EventTail` exists (offset, seq watermark); add bounded event history, truncation detection and reset, explicit release | Timeline, Output Channel | Core: `eventTail.ts` |
| G14 | Retention: limit with exemptions and a hidden-session count; adjustable effective limit for "Show more" (snapshot-only; the store's one remaining concern besides the scan) | Show more, never hiding Running | Core: `store.ts` |
| G15 | Pure grouping and attention: group of a snapshot, unique counted set (Unknown and Stopped excluded), status bar/badge summary | Trees, badge, status bar | Core: **new** `attention.ts` |
| G16 | Pure watch planning and routing: the desired set of non-recursive watched folders for a project, and classification of a changed path into a target | Watcher | Core: **new** `watchPlan.ts` |
| G17 | Per-key trailing debounce with max wait, injectable clock | Watcher | Core: **new** `coalescer.ts` |
| G18 | Timeline line formatting from `TailEvent` | Timeline, Output Channel | Core: **new** `timelineFormat.ts` |
| G19 | CLI locate (shell-free `LaunchSpec`: native executable or JavaScript entry only) and version check against a minimum-version constant, no `vscode` import | Capability; reused by phase 3 runner | **New** `src/cli/locate.ts`, `src/cli/version.ts` |
| G20 | Entire VS Code layer (registry, watcher, liveness, tails, capability, trees, content provider, log channels, status bar, Results host, commands, context keys) | Everything visible | Host, **new** `src/vscode/**` |
| G21 | Integration test harness (approved): `@vscode/test-electron` dev dependency, runner, fixture workspace, CI step with a display server on Ubuntu | S0 spike, all **I** rows | **New**; [`package.json`](../package.json), [`vitest.config.ts`](../vitest.config.ts), CI |
| G22 | ESLint `no-restricted-imports` forbidding `vscode` in `src/core/**` and `src/cli/**` (new repository rule, approved by the user) | AC17 | [`eslint.config.mjs`](../eslint.config.mjs) |

Readers added here are the read side only. Fingerprints, answer validation and serialization (3a) and canonical
next/handoff comparison for launching (3b) remain in those phases and extend the same modules.

## 4. Architecture

### 4.1 Layers and dependency direction

```text
src/extension.ts            activation: build registry + services, register views/commands, nothing else
src/vscode/**   (host)  --> src/core/**, src/cli/**, vscode API
src/cli/**      (no vscode) --> node:child_process, node:fs
src/core/**     (no vscode) --> node:fs, yaml

disk --(FileSystemWatcher)--> ProjectWatcher --> SessionStore / ProjectCatalog (core)
                                                     |  change events
                                                     v
                                            ProjectRegistry (re-emits MigentChange)
                                                     |
             trees · status bar · timeline provider · log channels · Results host
```

Rules:

- Only core readers touch Migent files. Host modules other than the watcher and services never call `fs`;
  views render store snapshots and catalog entries only.
- Commands in this phase only open files, copy text, reveal, refresh or recheck. Refresh calls store/catalog
  `load()`; it does not mutate snapshots directly.
- `src/cli/` and `src/core/` do not import each other's internals beyond types; neither imports `vscode`, enforced
  by the ESLint rule (G22).

### 4.2 Core modules (changed and new)

| Module | Responsibility | Status |
| :--- | :--- | :--- |
| `paths.ts` | Add the filenames and path helpers in G3 | Changed |
| `model.ts` | `question` state and `unknownReason`; decoupled manifest versions; question/outputs/next/lineage/scan/catalog types; extended change kinds | Changed |
| `displayState.ts` | Insert `question` (status `question`, no live lock) after Blocked; return the Unknown reason | Changed |
| `statusReader.ts` | Parse `questions` (pending summary, observed shape), `outputs` map, small fields of `latest_provider_event` only | Changed |
| `workflows.ts` | Entries with state/error; `readWorkflowFile`; duplicate-id detection | Changed |
| `projectConfig.ts` | Read config presence, parse validity, raw schema version; no defaults | New |
| `projectCatalog.ts` | One project: workflows + config, `load()`, `reloadWorkflow(file)`, `reloadConfig()`, `onDidChange` | New |
| `questions.ts` | Parse session `questions.json` v1; group pending by stage/execution; history order; lenient `superseded` | New (read side) |
| `outputs.ts` | Output rows from status map plus unnamed files; reject paths escaping the session directory | New |
| `nextWorkflows.ts` | Parse `next.json` v1 and frozen `downstream`; suggestion model with independent availability states | New (read side) |
| `handoff.ts` | Parse manifest `handoff` (observed shape); confine `path`; expose `source_path` as inert text | New (read side) |
| `attention.ts` | `groupOf`, `isCounted`, unique counts, summary text inputs | New |
| `executionFiles.ts` | Stateless listing of one execution's known files and `artifacts/` entries with availability; paths confined to the execution directory | New |
| `watchPlan.ts` | Desired non-recursive watch set for a project (§6.1) and classification of a changed path into a target | New |
| `coalescer.ts` | Keyed debounce (trailing, max wait), injectable timers | New |
| `timelineFormat.ts` | `TailEvent` → display line; raw-line passthrough | New |
| `store.ts` | Snapshots, scan outcome (G4), retention with exemptions and hidden count (G14). No detail cache, no `reconcile()` beyond `load()` | Changed |

### 4.3 Host modules (all new under `src/vscode/`)

| Module | Responsibility |
| :--- | :--- |
| `projects.ts` — `ProjectRegistry` | Discover projects, own one `ProjectContext` per project (store, catalog, watcher, capability entry), react to workspace folder changes, re-emit a unified change stream, dispose on removal |
| `watcher.ts` — `ProjectWatcher` | Own the project's non-recursive watcher set: diff the desired set from `watchPlan` against live watchers, create/dispose watchers, classify and coalesce events, call store/catalog methods (§6.1). Watcher creation goes through one narrow internal seam so the S0 fallback (§7.1) could replace the backend without touching `watchPlan` |
| `liveness.ts` | Single 10 s lock re-probe timer across projects, alive only while any session is Running |
| `tails.ts` | Reference-counted tail interest per `(project, session)`; owns one `EventTail` per interested session and drops it when interest reaches zero |
| `capability.ts` | Per-project CLI capability state using `cli/locate` + `cli/version`; Recheck; config change listener |
| `contextKeys.ts` | Window context keys for welcome/menus |
| `views/nodes.ts` | Node types, identity strings, `contextValue` builder |
| `views/sessionsTree.ts`, `views/workflowsTree.ts`, `views/projectTree.ts` | `TreeDataProvider`s; badge on Sessions |
| `statusBar.ts` | Attention/running summary item |
| `content/sessionDocs.ts` | `TextDocumentContentProvider` for `migent-session:` timeline documents |
| `log/channels.ts` | Per-session `LogOutputChannel`, at most 5, least recently used disposed first |
| `results/` | Read-only Results webview host, serializer, editor-title actions; assets in **new** `media/results/` |
| `pick.ts` | Quick Pick for project and session targets |
| `commands/*.ts` | One file per command (or small cohesive group), target captured at invocation |

Welcome content is declarative (`viewsWelcome` in `package.json`) driven by `contextKeys.ts`.

## 5. Contracts

### 5.1 Projects and stores

- A **project** is a workspace folder with `uri.scheme === 'file'` whose root contains a `.migent/` directory.
  Folders without it are ignored; `.migent/config.yaml` absence is shown in the Project tree, not used to exclude
  the folder. Virtual (non-`file`) folders are ignored. Nested `.migent/` below a folder root is out of scope.
- `ProjectKey` = `workspaceFolder.uri.toString()`. The core `projectRoot` is `uri.fsPath`. The registry owns the
  bidirectional mapping; host code uses `ProjectKey`, core events carry `projectRoot`.
- One `ProjectContext` per project: `{key, folder, store: SessionStore, catalog: ProjectCatalog, watcher,
  effectiveLimit}`. Created on discovery, disposed on folder removal (watchers, timers, tails, channels and
  Results panels of that project).
- Every `file` workspace folder gets a root anchor watcher (§6.1) owned by the registry, so a `.migent/` created
  later (for example by `migent init`) promotes the folder to a project without reload, and deleting `.migent/`
  demotes it (its `ProjectContext` is disposed and the folder returns to anchor-only).

### 5.2 Change notifications

Core keeps its local `Emitter`. Kinds:

- `SessionChangeEvent {project, sessionId, kind}` with kinds `added | updated | removed`. Events carry no snapshot
  payload; consumers read the store. The store knows nothing else about a session: executions, questions, outputs,
  next suggestions, lineage and events are read by their consumers (§6.2).
- `ProjectChangeEvent {project, kind: 'scan' | 'workflows' | 'config'}` (`scan` = sessions directory scan outcome
  or hidden count changed).

The registry re-emits one host stream:

```text
MigentChange =
  | { type: 'session'; project: ProjectKey; sessionId; kind: 'added' | 'updated' | 'removed' }
  | { type: 'files'; project: ProjectKey; sessionId; targets: FileTarget[] }  // watcher-classified, no store involved
  | { type: 'project'; project: ProjectKey; kind: 'scan' | 'workflows' | 'config' }
  | { type: 'projects' }                        // project added/removed
  | { type: 'refresh' }                         // full Refresh finished: re-read everything displayed
  | { type: 'capability'; project: ProjectKey }

FileTarget = { kind: 'questions' | 'next' | 'outputs' | 'executions' | 'events' }
           | { kind: 'execution'; executionId }   // any file under that execution directory
```

`files` changes are produced by the watcher from `watchPlan`'s classification and carry only file kinds, never data.

Consumers batch: each tree coalesces changes received in one event-loop turn into a single
`onDidChangeTreeData` fire with the narrowest affected element (session node for `files` targets `executions/questions/outputs`,
execution node for `files` target `execution`, the project's group nodes for state changes, the root for `projects`).

### 5.3 Item identity

Identity never includes state, so VS Code keeps selection and expansion across refreshes. `TreeItem.id`:

| Node | Id |
| :--- | :--- |
| Project root | `project:<ProjectKey>` |
| Group | `group:<ProjectKey>#<running\|attention\|recent>` |
| Session | `session:<ProjectKey>#<sessionId>` |
| Execution | `execution:<ProjectKey>#<sessionId>/<executionId>` |
| Synthetic container (Outputs, Questions, Next workflows, Lineage) | `<kind>:<ProjectKey>#<sessionId>` |
| Real file | `file:<fileUri>` |
| Workflow | `workflow:<fileUri>` |
| Config | `config:<ProjectKey>` |
| Show more / diagnostics | `more:<ProjectKey>`, `diag:<ProjectKey>#<code>` |

Command arguments are typed nodes carrying `ProjectKey` and session/file identity. Palette invocations resolve a
target through `pick.ts`; a stale tree selection is never an implicit target.

### 5.4 `contextValue` scheme

`<kind>.<qualifier>` followed by zero or more `;flag` tokens, in a fixed order.

- Session: `session.<displayState>` with flags `;questions` (pending human questions exist), `;foreign`
  (alive foreign-host lock), `;outputs` (published outputs exist). Example: `session.running;questions`.
  Unknown sessions add `;reason-<unknownReason>`.
- Execution: `execution.<status|unknown>`. Files: `file.<task|prompt|response|verify|artifact|output|questions|
  next|handoff>`. Containers: `outputs`, `questions`, `nextWorkflows`, `lineage.source`, `lineage.child`.
- Workflow: `workflow.ok`, `workflow.invalid`, `workflow.unreadable`. Config: `config.ok | config.invalid |
  config.missing | config.unreadable`. Diagnostics: `diag.<code>`.
- Menus match the base with `viewItem =~ /^session\.(stopped|blocked|failed)(;|$)/` and flags with
  `viewItem =~ /;questions(;|$)/`. Question-specific actions (phase 3a) must use the flag, never the state alone.

### 5.5 Capability state

`CapabilityState` per project (because `migent.cli.path` is resource-scoped):

```text
{ kind: 'checking' | 'ok' | 'missing' | 'unsupported' | 'old' | 'unparsable' | 'error',
  configured: string, launch?: LaunchSpec, detected?: string, required: string, detail?: string }

LaunchSpec = { command: string; prefixArgs: string[]; via: 'native' | 'node-script' }
```

- **Minimum version (decided).** A constant in extension code, initially `0.3.1`, is bumped in each extension
  release that needs a newer CLI. It is an environment requirement of the release, not a user setting (decided:
  there is no `migent.cli.minVersion`).
- **Invocation strategy (decided).** No shell is used, in this phase or in phase 3: every CLI process is started
  with `execFile`/`spawn` of `LaunchSpec.command` with `[...prefixArgs, ...args]` and `windowsHide: true`.
  `cli/locate.ts` resolves `migent.cli.path` to a `LaunchSpec`:
  1. Resolve a bare name through `PATH` (and `PATHEXT` on Windows, in order); an absolute or workspace-relative
     path is used as given. Nothing found → `missing`.
  2. A native executable (`.exe` on Windows; any non-script executable on POSIX, including npm's POSIX symlink to a
     `#!/usr/bin/env node` script, which the OS executes directly) → `via: 'native'`.
  3. A JavaScript entry (`.js`, `.mjs`, `.cjs`) → `via: 'node-script'`, `command` = `node` resolved through `PATH`,
     `prefixArgs` = `[entry]`. VS Code's Electron binary is never used as Node. Node not found → `unsupported`.
  4. Anything else, including `.cmd`, `.bat` and `.ps1` → `unsupported`, with the resolved path and the instruction
     to point `migent.cli.path` at `migent.exe` or the CLI's JavaScript entry. Because `PATHEXT` usually lists
     `.CMD`, a bare `migent` that resolves only to an npm shim lands here; the message names that case.
- Resolution is pure given injected `env`, `platform` and file-system probes, so it is vitest-tested on every
  platform. The phase 3 runner consumes the same `LaunchSpec`; it must not introduce a second resolution path.
- The version check runs `[...prefixArgs, '--version']` with a 5 s timeout and parses the first semver token.
- Checks are cached by `configured` value plus resolved path; projects sharing an executable share one probe.
- Triggers: activation (after views register, asynchronous), change of `migent.cli.*`, `migent.cli.recheck`.
  No periodic polling.
- Phase 2 gating: capability never hides disk-read data. Non-`ok` shows a diagnostic node at the top of that
  project's Sessions subtree (or welcome content when no sessions exist) with detected/required versions,
  executable path, Open Settings and Recheck. The same service is the gate phase 3 write commands consult; a
  `features` field is reserved for phase 3 probes such as `session cancel`.

## 6. Behavior

### 6.1 Watcher, debounce and re-read granularity

**Decision: only non-recursive watchers**, subject to the S0 spike (§7.1). Every watcher is
`createFileSystemWatcher(new RelativePattern(<folder URI>, <pattern without '/'>))`, which the VS Code API
documents as non-recursive and not subject to `files.watcherExclude`. No glob with path segments is used. A
non-recursive watcher observes only its base folder's direct children, so deletion or recreation of a folder is
observed by the watcher on its parent. The watched folders mirror the directories that currently exist:

| Watched folder | Pattern | Exists when | Purpose |
| :--- | :--- | :--- | :--- |
| Workspace folder root (anchor) | `.migent` | Always (owned by `ProjectRegistry`) | `.migent` create/delete → promote/demote project |
| `.migent/` | `{config.yaml,sessions,workflows}` | `.migent/` exists | Config changes; `sessions/`, `workflows/` create/delete |
| `.migent/workflows/` | `*.{yaml,yml}` | Folder exists | Workflow create/change/delete (rename = delete + create) |
| `.migent/sessions/` | `*` | Folder exists | Session directory create/delete |
| `.migent/sessions/<id>/` | `{manifest.yaml,status.json,session.lock,cancel.requested,questions.json,next.json,workflow.frozen.yaml,events.jsonl,executions,outputs}` | Every discovered directory under `sessions/`: eligible (retained or hidden) or pending (no marker yet) | Marker appearance, snapshot, details, tail, lineage |
| `.migent/sessions/<id>/executions/` | `*` | A consumer retained `executions` for the session | New execution directories |
| `.migent/sessions/<id>/executions/<eid>/` | `{execution.json,questions.json,prompt.md,task.md,response.md,stream.jsonl,artifacts,turns}` | A consumer retained that execution | Execution summary and file availability |
| `…/<eid>/artifacts/`, `…/<eid>/turns/` | `*` | A consumer retained that execution | Artifact listing; turn directory create/delete |
| `…/<eid>/turns/<turn>/` | `verify.md` | A consumer retained that execution **and** the turn directory exists | Verify file create/change/delete inside an existing turn |
| `.migent/sessions/<id>/outputs/` | `*` | A consumer retained `outputs` for the session | Unnamed output files |

Ownership and lifecycle:

- `watchPlan` (core, pure) computes the desired set from: anchor, which project folders exist (from the last scan
  outcomes of store and catalog), the discovered session directories (eligible and pending), the targets currently
  retained by consumers (§6.2) and the turn directories the watcher found. `ProjectWatcher`
  (host) diffs desired vs. live after every store/catalog change or retain/release that alters the set, creating
  missing watchers and disposing surplus ones. It is the only owner of `FileSystemWatcher` instances for its project and disposes all of
  them with the `ProjectContext`. The anchor watchers belong to `ProjectRegistry` and live as long as the folder.
- **Creation race.** After creating a watcher for a folder that just appeared, the owner immediately reconciles
  that level (session refresh, catalog reload or session scan) because files written before the watcher existed
  produced no event.
- **Ancestor deletion and recreation.** A delete event for a watched folder (seen by its parent's watcher) disposes
  the folder's watcher subtree and applies the matching state change: `.migent` → project demoted and disposed;
  `sessions/` → store scan outcome `missing`, all sessions removed; `workflows/` → catalog outcome `missing`;
  `<id>/` → session removed. A create event re-adds the watcher and reconciles that subtree. Because the anchor is
  never disposed while the folder is open, every level can be re-established without a window reload.
- **Turn directories.** For each retained execution the watcher lists `turns/` itself and passes the names to
  `watchPlan`, which emits one `turns/<turn>/` watcher per existing turn. A create event from the `turns/` watcher
  adds that turn's watcher and then emits a `files` change for the execution (creation-race rule), so a `verify.md`
  written before the turn watcher existed is still listed when the consumer re-reads. A delete event disposes the
  turn watcher and emits the same change.
- **Directory discovery is separate from session eligibility.** The scan reports every child directory of
  `sessions/`; only those with `manifest.yaml` or `status.json` become sessions (existing `listSessionIds` rule in
  [`store.ts`](../src/core/store.ts)). A directory without a marker is *pending*: it gets its session-level watcher
  but no snapshot, row or count. A marker create event from that watcher runs `refreshSession`, which promotes the
  directory to a session (`added`). When a pending directory's watcher is created, the creation-race rule refreshes
  it once, so markers written before the watcher existed are found. A deleted pending directory is dropped with its
  watcher. A session started with `migent session run` therefore appears even when its directory create event is
  processed before the CLI writes `manifest.yaml`.
- **Session watchers for every discovered directory (decided).** Every discovered session directory keeps its
  session-level watcher, eligible, hidden or pending, because resuming a hidden session changes files only inside
  its own directory and the `sessions/` watcher cannot see that. This lets a resumed hidden session become Running
  (and retention-exempt). Detail watchers exist only while a consumer retains their target (§6.2). Cost is checked by the
  S11 budget (§6.5).

Event handling:

- `watchPlan` classifies each event (`session file`, `execution file`, `workflow file`, `config`, `folder
  create/delete`); unknown paths are ignored without disk reads.
- Session changes coalesce per `(project, sessionId)` with a 150 ms trailing debounce and a 1 s max wait, collecting
  the set of changed files. On flush: if a snapshot file changed (`manifest.yaml`, `status.json`, `session.lock`,
  `cancel.requested`) the watcher calls `store.refreshSession(id)`; for every other file it emits one `files` change
  with the classified targets (§5.2). The watcher never reads detail data.
  `events.jsonl` changes trigger a tail read only when tail interest exists; otherwise they are dropped.
- A changed file of a hidden (eligible, not retained) session refreshes only its snapshot, to decide whether it
  became retention-exempt; it emits no `files` changes.
- A missing marker on refresh removes the session (`removed`).
- Workflow/config changes coalesce per project (150 ms) and re-read only the affected file. They never reload
  sessions, move focus, or open editors.
- `migent.refresh` runs full reconciliation (§6.2) and re-diffs every project's watcher set, recreating any watcher
  that failed or was lost; it is the recovery path for dropped events.

### 6.2 Reading on demand, watch interest and Refresh

**Decision (thin store).** The store holds snapshots only (manifest, status, lock, display state, the pending-question
summary and outputs map that come with `status.json`). Everything else is read from disk by a **stateless reader**
when a consumer needs it, and nothing is cached: executions (`listExecutions`), execution files
(`listExecutionFiles`), session `questions.json` history, outputs, `next.json` and frozen `downstream`, and lineage
children (`childrenOf` over `store.all()`). There is no dependency table, no derived invalidation, no interest counting
inside core and no `reconcile()` beyond `load()`.

| Data | Read when | Re-read when |
| :--- | :--- | :--- |
| Snapshot | Scan, and on `refreshSession` | Marker, `status.json`, `session.lock`, `cancel.requested` change; liveness tick (§6.3) |
| Executions list, execution files | `getChildren` of the session or execution node | A `files` change with target `executions` or `execution` for that session/execution |
| Questions history, outputs, next suggestions | `getChildren` of that node, or Results render | A `files` change with the matching target, or a `session` `updated` for that session (the pending summary and outputs map live in the snapshot) |
| Lineage | Results render, Lineage node | Any `session` change in the project |
| Event tail | §6.4 | `files` target `events` while a tail has interest |

Rules:

- **Readers are pure and synchronous.** A reader takes paths, returns a typed result with `missing`/`ok`/`invalid`
  states per §6.7, and keeps nothing. Repeated expand/collapse re-reads; each read is one small file or directory.
- **Watch interest, not data interest.** Only *what is watched* is counted. A consumer that displays a detail folder
  (an expanded session node watches `executions/`; an expanded execution node watches that execution's directory,
  `artifacts/`, `turns/` and existing `turns/<turn>/`; the Questions, Next workflows and Outputs nodes and an open
  Results panel watch their files and `outputs/`) calls `ProjectWatcher.retain(target)` and disposes the returned handle
  when it collapses or closes. The watcher keeps a reference count per target, adds the matching watchers (§6.1) on the
  first retain and removes them on the last release. When an ancestor collapses, VS Code reports only the ancestor, so
  the tree provider releases the handles of every descendant it holds under that ancestor. Release applies at the end
  of the event-loop turn, so a refresh that collapses and re-expands does not drop and recreate watchers.
- **Events for unwatched data are dropped.** A file under a folder nobody retained produces no watcher, hence no event.
  Session-level watchers are not detail watchers and stay (§6.1).
- **Cross-store joins.** Data combining a session with project metadata (suggestion target resolved against the
  workflow catalog) is computed by the consumer at render time from current store and catalog values. Consumers that
  show such joins subscribe to both `session` and `project: workflows` changes.
- **Full Refresh (`migent.refresh`).** `store.load()` (rescan, add, remove, apply retention, rebuild snapshots) and
  `catalog.load()`, re-diff every watcher set, then emit `{ type: 'refresh' }`; every consumer re-reads what it
  currently displays. It never runs automatically and is the recovery path for dropped watcher events.

### 6.3 Liveness timer

- One timer for the whole extension, 10 s interval, started when any project has a Running session and stopped when
  none remain. Lifecycle is driven by store change events, not by polling.
- Each tick calls `refreshSession` for Running sessions only (manifest + status + lock reads) and refreshes the
  elapsed-time description of Running rows. A hard-killed process therefore leaves Running within lock staleness
  (30 s) plus one interval.

### 6.4 Event tails

- Tailing is consumer-driven. Interest sources: an open timeline document for the session, and a created log
  channel while the session is Running. Running alone does not start a tail; row tooltips use `status.json`
  (`updated_at`, the small fields of `latest_provider_event`, `running_stages`).
- First interest triggers a read from offset 0 into a bounded history (decision: keep the most recent 5 000 events
  per session; older lines are dropped with a marker). Subsequent `events.jsonl` changes read incrementally.
- When interest drops to zero, `tails.ts` drops its `EventTail` and history. A log channel does a final read
  when its session stops being Running, then stops tailing; `showLog` performs a catch-up read.
- If the file shrinks below the stored offset, `EventTail` reports truncation and resets itself; `tails.ts` then
  notifies consumers so they re-render from the start. This replaces today's "keep offset" behavior.

### 6.5 Idle guarantee and performance budget

**Idle guarantee.** With no Running session and no open timeline/log consumer: zero timers, zero tails, no CLI
processes; work occurs only in response to watcher events or user commands. Capability checks run once per trigger.

**Budget (decided: synchronous readers stay; measured in S11).** Measured on Windows on the development machine,
release build, one workspace folder holding a generated project with 300 session directories (mix of terminal
states, one Running, default `migent.sessions.limit`):

| Metric | Budget |
| :--- | :--- |
| `activate()` return time (initial `load()` deferred until after it returns) | ≤ 200 ms |
| Initial scan + first Sessions render after activation | ≤ 2 s; no single synchronous block of the extension host > 500 ms |
| Extension-host CPU, nothing Running, no timeline/log open, 60 s after the scan | ≤ 1 % average (Process Explorer) |
| Extension-host CPU with one Running session (liveness timer active), 60 s | ≤ 2 % average |
| Live FileSystemWatcher count after the scan | Recorded (expected ≈ discovered session directories + project-level watchers) |

The thresholds are this plan's proposal and can be adjusted in review. Exceeding any of them is reported to the
user as a design decision (for example async readers, chunked scanning, or fewer session watchers); it is not
resolved inside an implementation PR.

### 6.6 Preserving selection, expansion and focus

- Stable ids (§5.3) and narrow refreshes; a Running → Completed move changes group membership but keeps the session
  id, so expansion of the session node is preserved.
- Background updates never call `reveal`, `showTextDocument`, `focus` or `panel.reveal`. Results panels update via
  `postMessage`; the timeline document via `onDidChange`. Only explicit user commands open or focus editors.

### 6.7 Invalid input, unknown schema, missing / empty / unreadable

| Input | Rendering |
| :--- | :--- |
| No project in any folder | Sessions welcome: no Migent project (Install CLI instructions link) |
| `.migent/sessions` missing or empty | Sessions welcome/empty node "No sessions yet"; Workflows and Project still render |
| `.migent/sessions` unreadable | Error node with code and Refresh; never "No sessions" |
| Corrupt or missing `status.json`, unparsable manifest, unsupported manifest version, unrecognized status value | Session stays visible as Unknown in Needs attention, not counted; icon by reason (`question` for unsupported schema or unrecognized status, `bracket-error` for missing, unreadable or invalid files); description and tooltip state the reason (for example "Unsupported schema version 3" or "status.json unreadable"); its files remain openable |
| Workflows dir missing / empty / unreadable | Distinct nodes: "No workflows directory", "No workflows", error with Refresh |
| Invalid or unreadable workflow file | Listed by filename with `$(error)` and parse message; opens the real file |
| Duplicate workflow ids | Each file listed with a duplicate-id diagnostic; no first-file-wins |
| Config missing / invalid / unreadable | Unavailable item with expected path (no file creation) / error item that opens the file |
| `questions.json` missing / invalid / unsupported version | "No structured history" / diagnostic with Open questions file; pending summary from status still shown |
| Question record with `status: superseded` (unobserved) | Listed in history as superseded; answer shown only if it matches an observed answer shape, otherwise omitted |
| `next.json` missing / invalid / unsupported; frozen declaration absent | Independent states; source stays Completed and outputs stay visible |
| Manifest `handoff` missing or not matching the observed shape | Source link from `prior_session_id` still shown; provenance shows a diagnostic with Open manifest |
| Unknown event `v` or malformed line | Timeline shows the raw line marked as unrecognized |
| Execution directory unreadable, file absent, `execution.json` invalid | Execution row from directory identity with a diagnostic; absent files omitted; an unreadable `artifacts/` shows an error child |
| Watched folder deleted (`.migent`, `sessions/`, `workflows/`, a session) | State per §6.1 ancestor rules; recreation restores watching and data without reload |

No reader infers defaults for unknown fields or versions.

### 6.8 Views (UI decisions retained from the outline)

**Sessions.** Project roots only when several projects exist. Groups by `attention.groupOf`: **Running** (Running),
**Needs attention** (Question, Blocked, Failed, Stopped, Unknown), **Recent** (Completed, Cancelled, Prepared);
empty groups hidden; a session appears once; Running sessions with pending questions stay in Running with an
indicator. Row: label = title (truncated ~60 chars, full in tooltip), description = `workflow · stage · elapsed`
(Unknown: the reason), icon from display state. Tooltip: blocker/failure summary, stage/attempt, last update, quota
retry time with timezone when present; missing reasons read "unavailable". Children: executions (`stage · attempt
n`, `provider/model · decision`) → the files reported by `listExecutionFiles` (§6.2): `task.md`,
`prompt.md`, `response.md`, `questions.json`, `turns/*/verify.md` as "verify · turn n", `stream.jsonl` (opened only
on request) and `artifacts/*`; absent files are omitted, never guessed. Outputs (when outputs exist); Questions
(pending groups by stage/execution with count; history on expand; Open questions file); Next workflows and Lineage
for Completed sessions or children with a prior. Completed row click runs `migent.session.openResult`; other rows
expand only. "Show more" appears when the project has hidden sessions and raises its effective limit by
`migent.sessions.limit` for the window lifetime.

**Retention decision.** The limit applies to retained snapshots after the full scan; sessions that are Running,
Question, Blocked or have pending questions are always retained, so the limit never hides work that needs a person.
Hidden count = eligible sessions − retained; pending directories are not counted.

**Badge.** Unique sessions that are Blocked, Failed, Question or have pending questions. Stopped and Unknown are
grouped under Needs attention but not counted. Tooltip breaks down stages/questions and blockers/failures.

**Workflows.** Entries per §6.7, grouped by project when several exist, labelled by id (filename fallback),
tooltip with project-relative path; click opens the real file. Only Open and Refresh in this phase.

**Project.** One `config.yaml` item per project per §6.7; click opens the real file. No copy into Settings.

**Welcome.** `viewsWelcome` for no project / no sessions / scan error / CLI unusable, keyed by context keys
`migent.hasProjects`, `migent.sessionsState` (`loading | empty | error | ready`), `migent.cliState`
(aggregate worst state). Only "Install CLI" (instructions) is live. Welcome never hides Workflows or Project.

**Status bar.** `$(sync~spin) Migent: N running · M needs attention`, either part alone when only one is non-zero,
hidden when both are zero; M uses the badge count; click focuses Sessions; tooltip breaks down by project, pending
questions and blocked/failed.

**Timeline document.** URI `migent-session:/<sessionId>/timeline?project=<encoded ProjectKey>`; lines like
`10:15:30 plan#1 started · codex/gpt-5` from `timelineFormat`; updates through `onDidChange`.

**Output Channel.** `migent.session.showLog` creates or reveals `Migent: <short id> <title>` (`LogOutputChannel`) fed
from the tail; at most 5 channels, least recently used disposed first.

**Results overview.** A read-only editor webview (`viewType: migent.results`) bound to `(ProjectKey, sessionId)`,
one panel per identity, reused on reopen, restored by a serializer. Content: header data (title, state, workflow,
completed time), published outputs (open real files), next-step suggestions (workflow id, default task, artifact
names with their source output, declared/undeclared, availability diagnostics, open target workflow file, open raw
`next.json`; `argv` is never shown as a runnable action), observed child sessions among retained sessions and, for
a child, the source link with handoff provenance (artifact name, output, local `handoff/<n>/<file>` link, sha256;
`source_path` as plain text only). A child whose source is not retained shows the source id as text with a
"Show more to load the source" hint. Header actions are native `editor/title` contributions gated by
`activeWebviewPanelId == 'migent.results'`: Open result, Open Task, View log, and a menu (Copy id, Reveal in
Explorer, Open questions). They act on the panel's bound session. The page never contains a task field, Run or
Prepare. Webview rules from [`03a-human-input.md` §9](./03a-human-input.md#9-webview-boundary): CSP
`default-src 'none'`, external script from `media/results/`, restricted `localResourceRoots`, inert text
rendering, revisioned messages; the webview sends intents with identity only (`openOutput{name}`,
`openNextFile`, `openTargetWorkflow{workflow}`, `openHandoffFile{name}`, `openSession{sessionId}`), never paths or
commands.

### 6.9 Settings and commands

Settings: `migent.cli.path` (resource scope, default `migent`), `migent.sessions.limit` (default 50).

Commands: `migent.session.openResult`, `migent.session.openTask`, `migent.session.openPrompt`,
`migent.session.openResponse`, `migent.session.openOutput`, `migent.session.openQuestions`,
`migent.session.showLog`, `migent.session.showTimeline` (see C3), `migent.session.copyId`,
`migent.session.revealInExplorer`, `migent.openConfig`, `migent.workflow.open`, `migent.refresh`,
`migent.openSettings`, `migent.cli.recheck` (see C3), `migent.sessions.showMore` (internal, hidden from Palette).

File commands open real files with `vscode.open`; a missing file shows a message naming the expected path and
never creates it.

## 7. Delivery slices

Each slice is one reviewable PR into `next`, updates the docs it affects ([§9](#9-documentation-impact)), and passes
`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (and, from S0 on, the integration command).

| Slice | Content | Depends on |
| :--- | :--- | :--- |
| S0 Harness and watcher spike | G21: `@vscode/test-electron` dev dependency, integration runner and command, vitest exclusion of integration tests, CI step (display server on Ubuntu, both OS rows), fixture-workspace copy helper; G22: ESLint `vscode` import rule; the watcher probe in §7.1 run against VS Code `1.90.0` and latest stable; result report in the PR | — |
| S1 Core state and catalog | G1–G7: `question` state, `unknownReason`, version decoupling, paths, scan outcome, workflow entry states, config reader, `ProjectCatalog`; fixtures for question status / invalid workflow / duplicate id / config states | — |
| S2 Core session readers | G8–G12a, G14, G15: status reader changes (pending questions, outputs map, small `latest_provider_event` fields), stateless questions/outputs/next/handoff/execution-files readers, lineage `childrenOf`, retention with exemptions and hidden count, attention; the store keeps snapshots only (executions and tail state already moved out); commit `src/core/fixtures/captured/` and test readers against it (§8.1); synthetic fixtures for pending questions in Running and Blocked sessions, next invalid/unsupported, superseded record | S1 |
| S3 Core events and watch planning | G13, G16–G18: bounded history and truncation in `EventTail`, `watchPlan` (desired set and classification), coalescer, timeline formatting | S1 |
| S4 Host skeleton | `ProjectRegistry` with anchor watchers, `ProjectWatcher` (watch-set diffing, creation-race reconcile, ancestor delete/recreate) built on the backend S0 validated, `retain`/release of watch targets, liveness, context keys, `migent.refresh` (full Refresh, `refresh` change), extension wiring | S0 (passed or fallback decided), S1, S2, S3 |
| S5 Sessions tree | Sessions provider, groups, Unknown reasons, executions/files/outputs/questions nodes, Show more, badge, file/copy/reveal commands, `pick.ts` | S2, S4 |
| S6 Workflows and Project trees | Both providers, `migent.workflow.open`, `migent.openConfig` | S1, S4 |
| S7 CLI capability | `src/cli/locate.ts` (native and JS entry only), `src/cli/version.ts` (minimum constant, effective max with the setting), capability service, diagnostics nodes, welcome content, settings, `openSettings`, `recheck`; vitest include for `src/cli/**` | S4 |
| S8 Timeline and logs | Tail interest manager, content provider, log channels, `showLog`, `showTimeline` | S3, S4 |
| S9 Status bar | Status bar item from attention summary | S2, S4 |
| S10 Results overview | Results host, `media/results/`, serializer, editor-title actions, `openResult`, Completed-row routing, lineage navigation among retained sessions | S2, S5 |
| S11 Phase verification | Windows manual pass (§8) including the §6.5 budget measurement (AC22), README monitoring section, final doc sweep | S5–S10 |

S0–S3 can proceed in parallel; S5–S9 can proceed in parallel after S4.

### 7.1 S0 watcher spike

**Question.** Do non-recursive `RelativePattern` watchers behave as §6.1 requires on Windows, on the minimum
supported VS Code (`engines.vscode`, currently `^1.90.0`, tested on `1.90.0`) and on the latest stable?

**Setup.** An integration scenario in the S0 harness, run on both versions on Windows (locally and on the
`windows-latest` CI row; Ubuntu also runs it for information). The workspace has `files.watcherExclude` set to
`{"**/.migent/**": true}` and `.migent` listed in `.gitignore`. The probe creates watchers matching the §6.1 table,
including brace-set patterns, then writes files from Node (not through VS Code APIs).

**Pass criteria** (every case on both versions; "delivered" = matching event within 2 s):

| # | Case | Expected |
| :--- | :--- | :--- |
| P1 | Session-level brace pattern: create, in-place modify, delete of `status.json`, `session.lock`, `events.jsonl` append | Each delivered as create/change/delete |
| P2 | Atomic replace of `status.json` (write temp file in the same folder, rename onto target) | At least one change or create event for `status.json`; no event for the temp name |
| P3 | `.migent/sessions/` with `*`: create, delete and rename of a child session directory | Create and delete delivered; rename delivered as delete(old) + create(new) or as change on both names |
| P4 | Anchor on workspace root with `.migent`: create and delete of `.migent/` | Both delivered |
| P5 | Folder lifecycle: delete a watched folder, recreate it, create a new watcher on it | Disposing the old watcher does not throw; the new watcher delivers P1-style events |
| P6 | `.migent/` with `{config.yaml,sessions,workflows}`: create/delete of `sessions/` and `workflows/`, change of `config.yaml` | All delivered |
| P7 | Excluded sibling sanity: an unwatched file next to a watched one | No event delivered for it |

What the old watcher on a deleted folder reports is recorded but not required.

**Fallback pre-check.** The same scenario also runs P1 and the directory cases (P3, P4, P5, P6) with non-recursive
`node:fs.watch` from the extension host, so the viability of the `fs.watch` fallback is known before anyone
decides. This is probe code only; no production backend is built in S0.

**Outcome.** The PR reports each case per version. All pass → S4 builds §6.1 as designed. Any failure → stop and
escalate to the user with the failing cases; S4 does not start until the user picks a fallback.

**Fallback design (stated, not built).**

- *Exclude-related failure* (P1–P4, P6 fail only with the exclude set): replace the watcher backend behind the
  `ProjectWatcher` seam with per-folder non-recursive `node:fs.watch` on the same folders from `watchPlan`. The plan,
  routing, coalescing and store contracts are unchanged. Cost: Node watchers bypass VS Code's watcher service, need
  explicit error handling on folder deletion, and must be counted in the §6.5 budget.
- *Parent events arrive, child watching fails* (P3, P4 and P6 pass; P5 fails): keep VS Code watchers. The parent's
  create event is the trigger: dispose any watcher on that path, create a fresh one and reconcile the subtree (scan
  plus watcher re-diff). If the fresh watcher still delivers nothing, handle it as the next case.
- *Parent create/delete events are missing* (P3, P4 or P6 fail): no VS Code event can trigger a reconcile, so the
  trigger must come from another source. Option 1: if the fallback pre-check passes for those cases, use
  `node:fs.watch` for the directory-level watchers only (anchor, `.migent/`, `sessions/`, `executions/`,
  `turns/`) and keep VS Code watchers for files. Option 2, only if `fs.watch` also fails: list the failing
  directory levels on a fixed interval. That breaks the idle guarantee (§6.5) and needs the user's approval.
  Window focus and `migent.refresh` stay manual recovery paths in every case; they are not enough on their own,
  because a session started from the integrated terminal never changes window focus.
- *Failure only on `1.90.0`*: raise `engines.vscode` and `@types/vscode` to the oldest passing version. This changes
  the supported VS Code range and requires user approval.

## 8. Acceptance criteria and verification

Layers: **U** = core/cli unit test with vitest; **I** = `@vscode/test-electron` integration test on a fixture
workspace; **M** = manual check on Windows (steps recorded in the PR); **L** = ESLint (`pnpm lint`).

| AC | Observable result | Layer |
| :--- | :--- | :--- |
| AC1 | Opening a workspace with the fixture sessions shows each in the correct group with the correct state/icon, including Question and Unknown | U (display state, grouping), I |
| AC2 | Running `migent session run` in a terminal makes the session appear as Running without Refresh, and its row reaches its persisted final state without Refresh; a session directory created empty, whose `manifest.yaml` is written only after its create event was processed, still appears | U (scan separates pending from eligible; `watchPlan` watches pending directories), M (Windows), I (simulated file writes, including the delayed-marker order) |
| AC3 | A session whose runner is hard-killed leaves Running within 40 s; no timer exists when no session is Running | U (liveness lifecycle with fake timers), M |
| AC4 | `config.yaml` and every workflow open in the native editor from the sidebar with the CLI missing and with no sessions | I |
| AC5 | Creating, renaming, deleting a workflow or editing config updates only that project's Workflows/Project data; no session store reload occurs | U (routing), I (store spy) |
| AC6 | An invalid or unreadable workflow and an invalid config are listed with their error and open the real file; duplicate ids are flagged | U, I |
| AC7 | Background updates keep tree selection and expansion and do not change the active editor or focused view | I (active editor/selection unchanged), M |
| AC8 | Pending questions are visible in Question, Blocked and Running sessions, grouped by stage/execution; history loads on expand with answered selections and free text; Open questions works without a compatible CLI | U (`question-pending`, `question-answered`, synthetic Running/Blocked), I |
| AC9 | Badge and status bar count unique Blocked, Failed, Question or pending-question sessions (one session with a blocker and questions counts once); Stopped and Unknown are not counted; each Unknown row shows its reason by icon and tooltip; status bar text forms and hidden state match §6.8 | U (attention summary, Unknown reasons), I |
| AC10 | Completed row click and Open result open the same Results panel with outputs, suggestions and the four header actions; missing/invalid `next.json` keeps the session Completed and outputs visible | U (`handoff-source` next/outputs), I (panel opens, header commands target source), M (rendering, keyboard) |
| AC11 | A child shows its source link and handoff provenance with the local `handoff/<n>/<file>` link and no link to `source_path`; the source shows its retained children; a child whose source is not retained shows the source id as text with a Show-more hint | U (`handoff-target` with `handoff-source`), I |
| AC12 | The timeline document renders events and appends new ones live; `showLog` streams a running session; an unknown event version appears as raw text | U (format, tail truncation), I |
| AC13 | Missing CLI, unsupported launcher (`.cmd`, `.bat`, `.ps1`, unknown), too-old and unparsable CLI each show a diagnostic with detected/required version and path, Open Settings and Recheck, while sessions remain visible; `required` is the minimum-version constant | U (`LaunchSpec` for `.exe`, JS entry, each unsupported kind; version parse/compare), I (bogus `migent.cli.path`), M (native `migent.exe` on Windows) |
| AC14 | Two projects with the same session id show two distinct rows; adding/removing a folder adds/removes its project without reload | I |
| AC15 | Missing, empty and unreadable sessions/workflows directories render the distinct states in §6.7 | U, I |
| AC16 | No file under `.migent/` is created or modified by the extension during the integration suite | I (tree hash before/after) |
| AC17 | `src/core/**` and `src/cli/**` contain no `vscode` import | L (`no-restricted-imports` rule) |
| AC18 | With `files.watcherExclude` containing `**/.migent/**` and `.migent` in `.gitignore`, sessions, workflows and config still update live | I (S0 probe, then full extension in S4), M (Windows) |
| AC19 | Deleting and recreating `.migent/sessions`, `.migent/workflows`, a session directory, or `.migent` itself updates the views accordingly and resumes live updates without Refresh or reload; no watcher remains for a deleted folder | U (`watchPlan` desired set), I |
| AC20 | Execution children list exactly the files present (including `turns/*/verify.md` and `artifacts/*`) and update when a response or artifact appears, or when `verify.md` is created in a new or existing turn directory; collapsing the execution releases its watch target and removes its detail-only watchers; tree code performs no file-system reads | U (`executionFiles`, `watchPlan` with retained targets), I |
| AC21 | When a `questions.json`, `next.json` or `outputs/` change is missed (simulated by writing while the watcher is suspended), `migent.refresh` makes the open Questions node and Results panel re-read and show it; a status change of the outputs map or pending summary updates the open nodes through the `session` `updated` change without a file event for them | U (readers), I |
| AC22 | With 300 session directories on Windows, every §6.5 budget row is met with all session watchers active, and with nothing Running and no timeline/log open there are no timers, tails or child processes; resuming a session outside the retention limit makes it appear as Running without Refresh | M (Windows, recorded measurements), U (tail/liveness lifecycle), I (resume of a hidden fixture session) |
| AC23 | Status reader keeps only the small fields of `latest_provider_event`; a status with a large `details.argv`/`usage` does not appear in snapshots or tooltips | U (synthetic large event) |

Renumbering from the previous draft: old AC16 (idle) merged into AC22; old AC17–AC23 became AC16–AC22; old AC24
(eviction) dropped with the deferred scope, and its `verify.md` part moved into AC20; AC23 is new.

### 8.1 Captured fixtures in the test plan

Tests read [`src/core/fixtures/captured/`](../src/core/fixtures/captured) in place (it is not part of the shared
`fixtures/sessions` layout). Where a test needs both handoff sessions in one project, it copies them into a
temporary sessions directory.

| Fixture | Verifies |
| :--- | :--- |
| `question-pending` | `statusReader` pending summary (all observed record fields, including `recommended` and option `description`); `displayState` → Question; `attention` counts it; session `questions.ts` with `pending` records and `answer: null`; `executionFiles` lists execution `questions.json`; `;questions` flag |
| `question-answered` | `statusReader` with `questions` key absent → no pending; Completed in Recent; `questions.ts` with `answered` records, `selected[]`, `{selected: [], text}` and `answered_at`; execution 0002 has no `questions.json` |
| `handoff-source` | `nextWorkflows.ts` v1 (`artifacts{name: {output, path}}`, `argv` kept but not actionable); `outputs.ts` from `status.json.outputs`; lineage source side with `handoff-target` |
| `handoff-target` | Manifest `schema_version: 2` supported; `handoff.ts` parse of inline JSON in YAML; `prior_session_id`; `path` confined to the session; `source_path` exposed as text only; `outputs.ts` for `ack`; lineage child side |

Unobserved shapes (superseded record, pending questions in Running/Blocked sessions, frozen `downstream`) use
synthetic fixtures named as such, so a future captured sample can replace them.

## 9. Documentation impact

- [`docs/architecture.md`](../docs/architecture.md): current runtime (activation now wires the registry), new
  composition diagram including host and `cli/`, ownership rows for each new module group, the change-stream
  contract, the non-recursive watcher tree and its ownership (or the S0 fallback, if chosen), the shell-free CLI
  `LaunchSpec` and the minimum-version rule.
- [`docs/core.md`](../docs/core.md): display-state table with Question and Unknown reasons; scan outcome and
  missing/empty/unreadable; workflow entry states; questions/outputs/next/lineage/execution-file read triggers,
  observed shapes and failure policy; stateless on-demand readers and watch interest,
  and full-Refresh reconciliation replacing the "callers must reload" note; retention exemptions and hidden count;
  tail state, bounded history and truncation reset replacing the "not automatically recovered" paragraph;
  synchronous readers and the §6.5 budget.
- [`docs/testing.md`](../docs/testing.md): the integration harness, when to use U vs. I vs. M vs. L, the captured
  fixtures and their rule (read in place, redacted, synthetic substitutes named as such); replace "not currently
  configured".
- [`CONTRIBUTING.md`](../CONTRIBUTING.md): integration test command, display server note for Linux, CI change,
  vitest scope (`src/cli/**` included, integration tests excluded), the new ESLint import rule.
- [`eslint.config.mjs`](../eslint.config.mjs): `no-restricted-imports` for `vscode` in `src/core/**` and
  `src/cli/**` (new rule, approved).
- [`vitest.config.ts`](../vitest.config.ts): include `src/cli/**/*.test.ts`; exclude `**/*.integration.test.ts`.
- [`package.json`](../package.json): `@vscode/test-electron` dev dependency, integration script, contributed
  views, commands, settings, menus and `viewsWelcome`.
- [CI](../.github/workflows/ci.yml): integration step on both OS rows with a display server on Ubuntu; whether to
  add `pnpm lint` is Q1.
- [`docs/README.md`](../docs/README.md): add a route for the VS Code layer (views, watcher, capability) if a new
  document is introduced; otherwise extend the architecture route.
- [`README.md`](../README.md): monitoring features, settings, CLI requirement (native `migent.exe` or JS entry;
  minimum version), `files.watcherExclude` note.
- `plans/01-core.md`: note that question/next/handoff readers moved to phase 2 (read side), see C1.

## 10. Conflicts with other plan files

- **C1** [`01-core.md`](./01-core.md) lists `questions`, `questionAnswers`, `nextWorkflows`, `handoff` and their
  fixtures as delivered in phase 1; they are absent. This plan builds the read side in S2 and leaves
  `questionAnswers` and fingerprints to 3a. `01-core.md` should be corrected rather than treated as done.
- **C2** [`03-control.md`](./03-control.md) assigns `cli/locate.ts` and `cli/version.ts` to phase 3, but the phase 2
  version check needs them. Phase 2 creates both; phase 3 adds `invoke.ts`, `runner.ts` and reuses them.
- **C3** Two commands not in the outline: `migent.session.showTimeline` (open the timeline document; the outline
  only names the URI) and `migent.cli.recheck` (the outline requires a Recheck action).
- **C4** The outline tails Running sessions unconditionally; this plan tails only on consumer interest (§6.4) to
  meet the idle guarantee. Tooltip data comes from `status.json`.
- **C5** The outline's menu regex `^session\.(stopped|blocked|failed)$` becomes `(;|$)`-terminated because of
  flags (§5.4).
- **C6** The outline's recursive watcher globs are replaced by a tree of non-recursive watchers (§6.1), and the
  watched set gains `events.jsonl`, `workflow.frozen.yaml`, execution files and folder create/delete.
- **C7** The outline's timeline URI `migent-session:/<id>/timeline` gains a `project` query for multi-root.
- **C8** [`03b-downstream-handoff.md` §5](./03b-downstream-handoff.md) asks for a lineage index "without requiring
  every source to be inside the recent-session limit" and resolution of a referenced source on demand. Phase 2
  shows only relations among retained sessions (§1, deferred); 3b keeps ownership of out-of-limit resolution and
  extends `handoff.ts` and the store index.
- **C9** [`vscode-extension.md` risks](./vscode-extension.md) mitigate many sessions with "watch only running
  sessions". This plan watches every discovered session directory (§6.1) so resumed hidden sessions are detected, and
  bounds the cost with the §6.5 budget instead.

## 11. Risks, trade-offs, assumptions and open questions

### Risks

| Risk | Mitigation |
| :--- | :--- |
| `.migent` excluded by `files.watcherExclude`, so recursive watchers deliver no events | Only non-recursive watchers (§6.1); S0 verifies the documented behavior on `1.90.0` and latest stable on Windows before S4; fallback stated in §7.1; AC18 re-verifies with the full extension; Refresh remains the recovery path |
| Windows watcher coalesces, reorders or reports rename as delete+create; atomic `status.json` rename observed mid-flight | S0 cases P2/P3; debounce with max wait, re-read by state not by event, `readStatus` retries, directory-level create/delete watcher |
| Many session directories mean many watchers and a large synchronous initial scan | Decided: keep every session watcher and synchronous readers; §6.5 budget measured in S11 (AC22); exceeding it is escalated to the user as a design decision |
| `readStatus` blocking retry sleep on the host | Counted inside the §6.5 "no block > 500 ms" row; if it dominates, escalate as part of the budget decision |
| Expanding and collapsing nodes re-reads files each time (no cache) | Each read is one small file or directory; watcher release waits for the end of the event-loop turn (§6.2); S11 records CPU while expanding; a cache is deferred (§1) |
| Results requires a webview, which 3b also specifies | Phase 2 builds the minimal read-only host so 3b only adds Next step; the host contract (identity binding, intents, CSP) is fixed here |
| npm-installed CLI resolves to a `.cmd` shim, which is `unsupported` | Explicit diagnostic telling the user to set `migent.cli.path` to `migent.exe` or the JS entry; shim parsing deferred (§1) |
| Captured samples are from one CLI version (0.3.1) and redacted; three shapes are unobserved | Readers validate observed shapes and stay lenient for unobserved ones (§2); synthetic fixtures are named so captured samples can replace them; the minimum-version constant prevents older CLIs |
| Lint rule (AC17) is not enforced in CI today | Q1 |
| Integration tests on CI (display server, VS Code download) are slower and can be flaky | Separate CI step; failures are investigated, not retried blindly; manual Windows pass remains the final check |

### Trade-offs

- Non-recursive watchers trade a larger, dynamically managed watcher set for immunity to user excludes and explicit
  ancestor handling.
- A thin store (snapshots only) removes the cache-versus-disk consistency problem and most of the lifecycle logic;
  the cost is that detail data is re-read on every expand and every relevant file change, and that the watcher
  carries the interest counting for detail folders.
- Retention exemptions mean the retained count can exceed the limit; in exchange the limit never hides work that
  needs attention.
- Consumer-driven tailing defers event loading until a user opens a timeline or log; tooltips rely on `status.json`.
- A separate `ProjectCatalog` instead of extending `SessionStore` keeps "one store = sessions of one project" and
  isolates workflow/config refresh from session refresh (AC5).
- Lineage among retained sessions only is simpler and cheaper, at the cost of a Show-more step to see an old source.
- Synchronous readers keep core simple and testable now; the budget decides whether async is needed later.

### Assumptions

- A1: Projects are workspace folder roots only.
- A2: `migent --version` prints a semver as the first token (observed `0.3.1`).
- A3: Session directories are append/replace-only except `events.jsonl` truncation by repair, which §6.4 handles.
- A4: The captured 0.3.1 shapes hold for every CLI version at or above the minimum constant; a CLI release that
  changes them is handled by bumping the constant together with the readers.
- A5: Manifest `handoff` and `status.json.handoff` carry the same mapping (observed); the reader uses the manifest.

### Open questions

- **Q1** CI does not run `pnpm lint`, so the approved `vscode` import rule (AC17) is enforced only locally and in
  PR review. Should S0 add a `pnpm lint` step to CI? This changes repository enforcement beyond the approved
  items and needs the user's decision; until then AC17 is verified by running `pnpm lint` in each slice PR.

## Interactive preview

Open [`designs/02-monitoring-ui.html`](../designs/02-monitoring-ui.html), keeping
[`project-files-ui.js`](../designs/project-files-ui.js) alongside it. Workflows and Project stay visible independently
of the session list. YAML highlighting/editing is simulated in the browser; saving changes only demo data in memory,
not repository files. The real extension opens the original files in native VS Code editors. All previews are
indexed in [`designs/README.md`](../designs/README.md).
