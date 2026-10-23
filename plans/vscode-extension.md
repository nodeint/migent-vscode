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
- Release: `vsce package` → VS Code Marketplace, plus Open VSX. Publisher: to be confirmed (see open questions).
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

## 4. Displayed state

`status.json.status` is not enough. An `active` session with no lock is just "stopped, can be resumed". The displayed state is derived as follows:

| Displayed | Condition | Icon (codicon) |
|---|---|---|
| Prepared | `status = prepared` | `circle-outline` |
| Running | lock is alive (see below) | `sync~spin` |
| Blocked | `status = blocked` | `warning` |
| Failed | `active`, no lock, `latest_execution_status = failed` | `error` |
| Stopped | `active`, no lock, last execution not failed | `debug-pause` |
| Cancelled | `status = cancelled` | `circle-slash` |
| Completed | `status = completed` | `pass` |
| Unknown | unknown schema, corrupt status.json | `question` |

**Lock is alive:** `session.lock` parses, `host` equals `os.hostname()`, `process.kill(pid, 0)` does not throw `ESRCH`, and `heartbeat_at` is within 30 seconds. A lock from another host shows Running (the pid cannot be checked) but write operations are disabled. If the lock cannot be parsed, fall back to the file's mtime, as `session-lock.ts` does.

`deriveDisplayState(status, lock, now)` is a pure function; the decision table above is its test suite.

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

### 5.1 SessionStore

- `Map<projectRoot, Map<sessionId, SessionSnapshot>>`.
- `SessionSnapshot` holds manifest, status, lock, displayState, a list of executions (lightweight: id, stage, attempt, status, decision) and `lastEventSeq`.
- `onDidChange(event: {project, sessionId, kind})` so views refresh only what changed.
- Initial load: scan `.migent/sessions/*/` (direct reads, faster than spawning the CLI). `migent session list --json` is used only for reconciliation when diagnostic mode is on.
- Lazy loading: the initial list reads only manifest + status + lock. The execution list is read only when a session node is expanded or the session is running.
- Limit: show the N most recent sessions (default 50) with a "Show more" item. The sessions directory can reach hundreds of entries.

### 5.2 Watcher

- One `FileSystemWatcher` per project: glob `.migent/sessions/*/{status.json,session.lock,cancel.requested}` and `.migent/sessions/*/executions/*/execution.json`. The `.migent` directory is often hidden by the user's `files.watcherExclude`; use `RelativePattern` on concrete paths and verify during Windows testing.
- Coalesce events with a 150ms debounce per session. Each time, re-read that session only, not the whole directory.
- A 10-second timer runs only while at least one session is Running: it re-checks `lockProbe` to catch dead locks that emit no file event (hard-killed process).
- `status.json` is written atomically so reads are complete. On a parse error (seen during a rename on Windows), retry after 100ms, up to 3 times, then mark Unknown.

### 5.3 Event tail

- Used for the per-session Output Channel and real-time notifications. Keep an `offset` per session; each read goes from `offset` to end of file and processes only lines terminated by `\n`, keeping the remainder for next time (the log may be partially written; the kernel has `sealTornTail`).
- `seq` is used for de-duplication. On an unknown `v`, show the raw line rather than dropping it.
- Tail only sessions whose log is open or that are Running, to save resources.

### 5.4 Command execution (`cli/`)

- **Short commands** (`--version`, `session show --json`, `prepare`): `execFile` with a timeout, parse JSON, typed errors.
- **Long commands** (`session run`, `session continue`): `spawn` with `windowsHide: true`, `stdio` read (stderr is a line-based log), `detached: true` on POSIX so the process survives a window reload. On Windows, separately verify that the child keeps running after the extension host exits (see risks). No shell; pass `argv` directly.
- Environment: inherited from VS Code; extra variables can be set via the `migent.env` setting.
- Result: map the exit code to an enum (`Completed | NotFinished | StageFailed | VerifyExhausted | Quota | Cancelled | ConfigError`), with the `response:` or `verify:` line from stderr so the related file can be opened quickly.
- Concurrency: `SessionLock` already blocks two processes on the same session, but the extension also checks beforehand (Run/Continue are disabled while Running) to avoid error messages.
- `--max-dispatches` and similar flags come from settings, not from a prompt each time.

## 6. UI

### 6.1 Activity Bar: "Migent" container

One view container with two views:

1. **Sessions** (TreeView). Elements:
   - Group root (when multi-root has several projects): project name.
   - Groups by state: **Running**, **Needs attention** (Blocked, Failed, Stopped), **Recent** (Completed, Cancelled, Prepared). Empty groups are hidden.
   - Session: label = `title` (truncated at ~60 characters, full text in the tooltip), `description` = `workflow · current stage · elapsed time`, icon by displayState.
   - Children of a session: executions in `execution_order` (`plan · attempt 2`), `description` = `provider/model · decision`, icon by status. Children of an execution: `prompt.md`, `response.md`, `verify`, `artifacts/*` (open the real files).
   - An "Outputs" node lists `outputs/*` when the session is Completed.
2. **Workflows** (TreeView, phase 2). Lists workflows in `.migent/workflows/`; click to open the YAML, with a Run button.

`contextValue` is composed from displayState, e.g. `session.running`, `session.blocked`, `session.stopped`, `session.completed`, `session.prepared`. Context menus use `when: viewItem =~ /^session\.(stopped|blocked|failed)$/`.

The view shows a badge with the number of Blocked + Failed sessions needing attention (`TreeView.badge`).

Welcome view when there is no CLI, no `.migent`, or no sessions: buttons "Install CLI", "Initialize project" (`migent init`, driven by Quick Pick prompts), "Run workflow".

### 6.2 Commands (Command Palette and menus)

| Command | Behavior |
|---|---|
| `migent.session.run` | Quick Pick workflow → Input Box task (single line) → run. Has a "Compose a long task" option that creates a prepared session |
| `migent.session.prepare` | Enter a title, create the session, open `task.md` for writing, then a "Run" button in the editor title |
| `migent.session.start` | Run a prepared session (`run --session --workflow`) |
| `migent.session.continue` | `session continue`; asks about `--refresh-workflow` if the workflow changed from the frozen copy |
| `migent.session.continueOnce` | `--once` |
| `migent.session.reply` | Blocked sessions only: open a temp editor (or multi-line Input Box) to write the reply, pick the stage if several are blocked, `continue --reply-file` |
| `migent.session.cancel` | `session cancel <id>`, shows a waiting progress |
| `migent.session.repair` | `session repair` (confirm first) |
| `migent.session.openTask` / `openPrompt` / `openResponse` / `openOutput` | Open files |
| `migent.session.showLog` | Open the session's Output Channel |
| `migent.session.copyId` / `revealInExplorer` | Utilities |
| `migent.refresh` | Rescan |
| `migent.doctor` | `migent doctor --json` shown in Output or a light webview |
| `migent.openSettings` | |

Every write command checks: the CLI version is sufficient, no live lock belongs to another process, and the project is not in read-only mode.

### 6.3 Viewing content

- `prompt.md`, `response.md`, `task.md`, `artifacts/*`, `outputs/*`: open the real files on disk (syntax highlighting, search and diff come for free). No copies are made.
- **Aggregated session log** (`migent-session:/<id>/timeline`): a `TextDocumentContentProvider` renders `events.jsonl` into readable lines (`10:15:30 plan#1 started · codex/gpt-5`), with `onDidChange` when the file changes.
- **Output Channel** (per-session `LogOutputChannel`) for stderr lines of commands the extension runs. For sessions started elsewhere, use the event tail.
- Diff of code-modifying executions: use git (`vscode.git` API or `git diff` by ref); deferred to a later phase.

### 6.4 Status bar and notifications

- Status bar (left): `$(sync~spin) Migent: 2 running` or `$(warning) 1 blocked`; click to focus the Sessions view. Hidden when there is nothing to report.
- Notifications (each type can be disabled in settings): Blocked ("Reply" button), Failed ("Continue" / "View log" buttons), Quota (with `retry_at`, and a reminder when it expires), Completed ("Open result" button). Only notify on state transitions that happen **after** the extension activates, to avoid a flood when a window opens.
- Progress: `window.withProgress` (Notification location, cancellable) for a run started by the extension itself; cancelling calls `session cancel`.

### 6.5 Settings (`migent.*`)

| Key | Default | Meaning |
|---|---|---|
| `migent.cli.path` | `""` | Binary path; empty = look on PATH, then `node_modules/.bin` |
| `migent.cli.minVersion` | set by the extension | not editable in the UI, read-only |
| `migent.sessions.limit` | 50 | number of sessions shown |
| `migent.run.maxDispatches` | 20 | passed as `--max-dispatches` |
| `migent.run.progress` | true | passed as `--progress` |
| `migent.notifications.*` | true | blocked / failed / quota / completed |
| `migent.env` | `{}` | extra environment variables for the CLI |

## 7. Webview (later phase)

Only for two things that native UI cannot do:

1. **Workflow graph:** stages, `depends_on`, decision routes, colored by the progress of the selected session. Data is sent by the host (JSON); the webview does not read files.
2. **Metrics dashboard:** tokens, cost, duration per session and per execution from `metrics.json`.

Rules: CSP `default-src 'none'` + `webview.cspSource`, external scripts (no inline), `localResourceRoots` limited to the extension's `media/` directory, a nonce for scripts, `getState/setState` instead of `retainContextWhenHidden`, and a `WebviewPanelSerializer` to restore after a reload. Use plain HTML or Preact and draw with SVG (see the `artifact-diagramming` skill for how to draw graphs); do not pull in a heavy framework. The host sends state with an increasing sequence number so the webview can discard stale packets.

## 8. Roadmap and exit criteria

### Phase 0: Preparation (outside the extension repo)
- Finish `session cancel` (separate plan).
- Review `docs/sessions.md` as the contract document; record in migent's CONTRIBUTING that changing a file format is a contract change.
- Settle the publisher and extension name (`migent` / `nodeint.migent-vscode`).

### Phase 1: Skeleton and `core/` (read, no UI yet)
- Scaffold the repo, esbuild, vitest, CI (build + test + `vsce package` on Windows and Linux).
- Install `yaml`. Write `paths`, `manifest`, `statusReader`, `lockProbe`, `displayState`, `eventTail`, `executions`, `store`.
- Build fixtures from real sessions: completed, active-stopped, failed, blocked, cancelled, prepared, running (fake live lock), stale lock, corrupt status.json, unknown schema.
- **Done when:** the whole state table in section 4 has tests; `eventTail` handles the partial-line case; no file in `core/` imports `vscode`.

### Phase 2: Monitoring (read-only MVP)
- Activation, `projects`, watcher, Sessions tree, welcome view, status bar, file-opening commands (`openTask/Prompt/Response/Output`), Output Channel, timeline document, `copyId`, `refresh`.
- CLI version check.
- **Done when:** opening this migent repo shows the existing sessions with the correct states; running `migent session run` in another terminal makes the session appear as Running and change state at the right time without a refresh; no CPU usage when idle.

### Phase 3: Control
- `cli/` (locate, invoke, runner), the Run, Prepare + Start, Continue, ContinueOnce, Reply, Cancel and Repair commands.
- `withProgress`, Blocked/Failed/Quota/Completed notifications.
- **Done when:** the `plan` workflow runs end to end from the Command Palette; cancelling midway on Windows yields exit 130 and Continue can resume; Reply works for a Blocked session; two places pressing Run at once produce no strange errors.

### Phase 4: Polish and release 0.1
- Multi-root, settings, `migent doctor`, `migent init` in the UI, README, icon, screenshots, CHANGELOG, packaging and publishing.
- Manual testing against a checklist (Windows, macOS, Linux, Remote-SSH/WSL).

### Phase 5 (0.2+): Workflow graph, metrics, execution diff, JSON schema + autocomplete for `.migent/workflows/*.yaml`, workspace list via a registry service.

## 9. Testing

- **Unit (`core/`):** vitest, building temp directories from fixtures, no VS Code needed.
- **CLI:** mock `child_process` to check arguments, exit-code mapping, `windowsHide`, and line-based stderr handling.
- **Integration:** `@vscode/test-electron` opens a sample workspace containing `.migent`, checks that the tree appears, commands are registered, and state changes when fixture files are edited. For real runs, use a `fake-provider.mjs` like migent's `integration/`.
- **Contract:** a test that reads sessions produced by a real migent (CI runs a workflow with a fake provider in the extension repo, or a script refreshes fixtures when migent changes version) to detect format drift.
- **Windows** is a mandatory CI environment because the main risks are there.

## 10. Risks and mitigations

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

## 11. Open questions

1. The publisher name on the Marketplace and Open VSX, and the extension's display name.
2. The minimum `engines.vscode` version to support.
3. Is Remote (SSH, WSL, Dev Containers) needed from 0.1? The extension runs on the workspace host (`extensionKind: ["workspace"]`), so in theory it already works; the catch is that the CLI must be installed on the remote machine.
4. Phase 3: must processes started by the extension survive closing VS Code? This decision affects `detached` and whether users wrongly assume work stopped when they quit.
5. Telemetry: none (proposed).
6. License: MIT, like migent.
