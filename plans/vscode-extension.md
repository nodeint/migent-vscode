# Plan: Migent for VS Code

Goal: let developers manage and monitor sessions and run workflows directly inside VS Code, without opening a terminal.

Prerequisite: [`session-cancel.md`](./session-cancel.md) must land first, because the Stop button needs `migent session cancel` (Windows has no signal for a graceful cancel).

## 1. Design principles

1. **Native first, webview later.** TreeView, Quick Pick, Input Box, status bar, notifications and the built-in editor cover 90% of the needs. Webviews are only for the workflow graph and the metrics dashboard (later phase).
2. **Files are the source of truth.** The extension reads `.migent/sessions/**` and keeps no state of its own. Sessions started from a terminal or by another agent show up too.
3. **Commands go through the CLI.** Every write operation (run, continue, cancel, prepare) calls `migent`. The extension never writes to `status.json`, `events.jsonl`, `manifest.yaml` or `executions/` (docs/sessions.md forbids hand-editing these files).
4. **Do not import `@nodeint/migent-kernel`.** The README says internal packages have no stable API. The only contract is: documented file formats, `--json` output and exit codes.
5. **Pure logic is separated from `vscode`.** The `core/` directory never imports `vscode` and can be tested with vitest without launching VS Code.
6. **Refuse to guess.** On an unknown `schema_version` or CLI version, switch to read-only mode and say so clearly instead of inferring.

## 2. Repo, tooling, release

- Separate repo: `nodeint/migent-vscode` (reason: the extension is only a consumer of the public contract; its toolchain and release cadence differ from the CLI).
- TypeScript, built with esbuild (a single bundled `dist/extension.js`, `external: ["vscode"]`), tested with vitest for `core/` and `@vscode/test-electron` for integration.
- Package manager: pnpm (matches migent). Lint/format follow migent's config where available.
- Release: `vsce package` → VS Code Marketplace, plus Open VSX. Publisher: `nodeint` (see Decisions).
- `engines.vscode`: `^1.90.0` (re-confirm when scaffolding; only raise it when a newer API is needed).
- Activation: `activationEvents: ["workspaceContains:.migent/config.yaml"]`, never `*`.
- Multi-root workspaces: each folder containing `.migent/` is its own "project".

## 3. Contract with migent

The extension depends on the following. Changing any of them is a contract change, must bump `schema_version`, and must be communicated to the extension repo.

| Source | Used for | Notes |
|---|---|---|
| `manifest.yaml` | id, title, workflow_id, created_at, `schema_version` | currently `schema_version: 2` |
| `status.json` | session status | written atomically |
| `session.lock` | session is running | `{pid, host, started_at, heartbeat_at, nonce}`, stale after 30 seconds |
| `events.jsonl` | timeline | envelope `{v, seq, event, timestamp, execution_id, stage_id, summary, data}` |
| `executions/<id>/execution.json` | stage, attempt, provider, model, status, outcome, owner_pid, hostname | |
| `executions/<id>/{prompt.md,response.md,artifacts/,turns/*/verify.md}` | open for viewing | read-only |
| `executions/<id>/stream.jsonl` | detailed provider log | read only when the user opens it |
| `outputs/*` | published results | `status.json.outputs` carries paths and provenance |
| `metrics.json` | tokens, cost, duration | only present once a workflow session is `completed` |
| `.migent/workflows/*.yaml` | workflow list for Run | read `id`/file name and `stages` for display |
| `migent --version` | compatibility check | |
| `migent session list/show/metrics --json` | initial load, reconciliation | |
| `migent session run/continue/prepare/cancel` | operations | exit codes: 0 done, 1 not finished, 3 stage_failed, 6 verify_exhausted, 7 verify, 8 quota, 130 cancelled |

Startup check: `migent --version` ≥ the minimum version (configured in the extension). If the CLI is missing or too old, show a welcome view with install instructions and switch to read-only. If `session cancel` is missing, hide the Stop button.

## 4. Phases

Each phase has its own plan file with scope, details and exit criteria. Display state, SessionStore, watcher, event tail, CLI execution, UI, settings and webview details live in those files.

| Phase | File | Outcome |
|---|---|---|
| 0 | (below) | Preparation outside this repo |
| 1 | [`01-core.md`](./01-core.md) | Skeleton, `core/`, display state, store, event tail, fixtures |
| 2 | [`02-monitoring.md`](./02-monitoring.md) | Read-only MVP: watcher, Sessions tree, status bar, logs |
| 3 | [`03-control.md`](./03-control.md) | Run/continue/reply/cancel via CLI, notifications |
| 4 | [`04-release.md`](./04-release.md) | Multi-root, Workflows view, docs, testing checklist, release 0.1 |
| 5 | [`05-later.md`](./05-later.md) | Workflow graph, metrics dashboard, execution diff, schema |

### Phase 0: Preparation (outside the extension repo)
- Finish `session cancel` ([`session-cancel.md`](./session-cancel.md)).
- Review `docs/sessions.md` as the contract document; record in migent's CONTRIBUTING that changing a file format is a contract change.
- Settle the publisher and extension name (`migent` / `nodeint.migent-vscode`).

## 5. Architecture

```
migent-vscode/
  src/
    extension.ts               # activate/deactivate: wiring only
    core/                      # does NOT import vscode
      paths.ts                 # paths inside .migent
      manifest.ts              # parse manifest.yaml (`yaml` library)
      statusReader.ts          # safe status.json reader (retry while being written)
      lockProbe.ts             # session.lock -> alive | stale | none
      displayState.ts          # deriveDisplayState
      eventTail.ts             # tail events.jsonl by byte offset
      executions.ts            # read execution.json for the tree
      workflows.ts             # list and read .migent/workflows
      model.ts                 # types: SessionSnapshot, ExecutionSnapshot...
      store.ts                 # SessionStore: snapshot + change events
    cli/
      locate.ts                # find the migent binary (setting, PATH, node_modules)
      invoke.ts                # run short commands, parse --json
      runner.ts                # manage long-running processes: run/continue, cancel
      version.ts               # compatibility check
    vscode/                    # glue to the VS Code API
      projects.ts              # track workspace folders containing .migent
      watcher.ts               # FileSystemWatcher -> store
      views/sessionsTree.ts
      views/welcome.ts
      statusBar.ts
      notifications.ts
      content/sessionDocs.ts   # TextDocumentContentProvider
      log/channels.ts          # per-session LogOutputChannel
      commands/*.ts            # one file per command
      pick.ts                  # Quick Pick for workflows, sessions
  test/
    fixtures/sessions/         # real (redacted) sessions, one per state
    core/*.test.ts
    integration/*.test.ts
  package.json  esbuild.mjs  tsconfig.json  .vscodeignore
```

Data flows one way: **watcher → store → view**. Views never read the disk themselves. Commands call the CLI, and the result comes back through the watcher (files change); commands never update the store directly, which avoids two sources of truth.


## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cancelling a session on Windows | Wait for `session cancel`; hide the Stop button if the CLI lacks it |
| `detached` child on Windows opens a console window or dies when VS Code exits | `windowsHide: true`; test early in phase 3 and decide between detached and attached to the extension host |
| VS Code watcher is late, coalesces or drops events | Debounce, re-read by state (not by event), 10-second timer while something is Running |
| `.migent/sessions` hidden by `files.watcherExclude` or `.gitignore` | Use `RelativePattern`; test with default config; note it in the README |
| `status.json` read mid-write | Atomic writes on the migent side; up to 3 re-reads |
| Hundreds of sessions slow things down | Lazy loading, limit N, watch only running sessions |
| Migent changes file formats | `schema_version`, fixtures, contract tests, read-only mode |
| Lock from another machine (shared folder) | Show Running, disable write operations |
| Sensitive data in fixtures | Redact paths, hostnames and real prompts before committing |

## 7. Decisions

1. Publisher `nodeint`, display name `Migent`. The publisher must be created on the VS Code Marketplace and Open VSX before phase 4.
2. `engines.vscode`: `^1.90.0`; only raise it when a newer API is needed.
3. Remote (SSH, WSL, Dev Containers): no special work for 0.1. `extensionKind: ["workspace"]`; the README states the CLI must be installed on the remote machine; one manual WSL test before release.
4. Processes started by the extension always survive closing VS Code (detached). No setting, no warning on close. Verify early in phase 3 that this works on Windows; if not, decide a fallback then.
5. Telemetry: none.
6. License: MIT, like migent.
