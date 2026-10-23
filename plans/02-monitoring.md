# Phase 2: Monitoring (read-only MVP)

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`01-core.md`](./01-core.md). Next: [`03-control.md`](./03-control.md).

## Scope

Activation, `projects`, watcher, Sessions tree, welcome view, status bar, file-opening commands (`openTask/Prompt/Response/Output`), Output Channel, timeline document, `copyId`, `refresh`, and the CLI version check.

## 1. Watcher (`vscode/watcher.ts`)

- One `FileSystemWatcher` per project: glob `.migent/sessions/*/{status.json,session.lock,cancel.requested}` and `.migent/sessions/*/executions/*/execution.json`. The `.migent` directory is often hidden by the user's `files.watcherExclude`; use `RelativePattern` on concrete paths and verify during Windows testing.
- Coalesce events with a 150ms debounce per session. Each time, re-read that session only, not the whole directory.
- A 10-second timer runs only while at least one session is Running: it re-checks `lockProbe` to catch dead locks that emit no file event (hard-killed process).
- Tail events only for sessions whose log is open or that are Running, to save resources.

## 2. Activity Bar: "Migent" container

**Sessions** (TreeView):

- Group root (when multi-root has several projects): project name.
- Groups by state: **Running**, **Needs attention** (Blocked, Failed, Stopped), **Recent** (Completed, Cancelled, Prepared). Empty groups are hidden.
- Session: label = `title` (truncated at ~60 characters, full text in the tooltip), `description` = `workflow · current stage · elapsed time`, icon by displayState.
- Children of a session: executions in `execution_order` (`plan · attempt 2`), `description` = `provider/model · decision`, icon by status. Children of an execution: `prompt.md`, `response.md`, `verify`, `artifacts/*` (open the real files).
- An "Outputs" node lists `outputs/*` when the session is Completed.
- A "Show more" item beyond `migent.sessions.limit`.

`contextValue` is composed from displayState, e.g. `session.running`, `session.blocked`, `session.stopped`, `session.completed`, `session.prepared`. Context menus use `when: viewItem =~ /^session\.(stopped|blocked|failed)$/`.

The view shows a badge with the number of Blocked + Failed sessions needing attention (`TreeView.badge`).

**Welcome view** when there is no CLI, no `.migent`, or no sessions. In this phase only "Install CLI" (instructions) is live; "Initialize project" and "Run workflow" arrive in phases 3 and 4.

Views never read the disk themselves: data flows **watcher → store → view**.

## 3. Viewing content

- `prompt.md`, `response.md`, `task.md`, `artifacts/*`, `outputs/*`: open the real files on disk. No copies are made.
- **Aggregated session log** (`migent-session:/<id>/timeline`): a `TextDocumentContentProvider` renders `events.jsonl` into readable lines (`10:15:30 plan#1 started · codex/gpt-5`), with `onDidChange` when the file changes.
- **Output Channel** (per-session `LogOutputChannel`). In this phase it is fed by the event tail for sessions started elsewhere.

## 4. Status bar

Left: `$(sync~spin) Migent: 2 running` or `$(warning) 1 blocked`; click to focus the Sessions view. Hidden when there is nothing to report.

## 5. CLI version check

`migent --version` ≥ the minimum version (`migent.cli.minVersion`). If the CLI is missing or too old, show the welcome view with install instructions and switch to read-only. If `session cancel` is missing, hide the Stop button (relevant from phase 3).

## 6. Settings introduced

`migent.cli.path`, `migent.cli.minVersion`, `migent.sessions.limit`.

## Commands introduced

`migent.session.openTask`, `openPrompt`, `openResponse`, `openOutput`, `showLog`, `copyId`, `revealInExplorer`, `migent.refresh`, `migent.openSettings`.

## Done when

- Opening the migent repo shows the existing sessions with the correct states.
- Running `migent session run` in another terminal makes the session appear as Running and change state at the right time without a refresh.
- No CPU usage when idle.
