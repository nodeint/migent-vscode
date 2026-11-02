# Architecture

This page maps the extension's runtime composition and module responsibilities.
For file-reader and state behavior, see [Core behavior](core.md).

## Current runtime

[extension.ts](../src/extension.ts) builds a `ProjectRegistry`, the context keys and
the liveness timer, and registers `migent.refresh`. It returns a small API
(`registry`, `capability`, `tails`, `logs`, `ready`) that integration tests use. Discovery and the first load run
after `activate()` returns. The Sessions view and its read-only commands exist; the Workflows and
Project views, status bar and Results page do not yet. Timeline documents and per-session log channels read
`events.jsonl` only while one is open. CLI capability checks run once
per trigger (a project appearing, a `migent.cli.*` change, Recheck) and never hide data read from disk.

Data flows watcher, then store, then consumer; consumers never read disk:

```text
disk --FileSystemWatcher--> ProjectWatcher --> SessionStore / ProjectCatalog (core)
                                   |                   | change events
                                   v                   v
                             `files` changes     ProjectRegistry --> MigentChange stream
```

The registry owns one `ProjectContext` per workspace folder that has a `.migent/`
directory (store, catalog, watcher) and an anchor watcher per `file` folder, so
creating or deleting `.migent/` promotes or demotes the folder without a reload.
Each `ProjectWatcher` mirrors core's desired watcher set (non-recursive watchers,
one per folder), classifies and coalesces events, and calls the store, the catalog
or the `files` callback. Consumers keep detail folders watched with
`retain(target)` and release them by disposing the handle. Watcher creation goes
through [watchBackend.ts](../src/vscode/watchBackend.ts), the one seam a
different backend would replace.

The store holds an in-memory projection; persisted Migent files remain the source
of truth. Core imports no `vscode` API and does not modify session files.

## Ownership map

| Responsibility | Implementation | Boundary |
| :--- | :--- | :--- |
| Activation and command registration | [extension.ts](../src/extension.ts) | VS Code lifecycle and wiring |
| Project discovery and change stream | [projects.ts](../src/vscode/projects.ts), [changes.ts](../src/vscode/changes.ts) | One `ProjectContext` per project; re-emits store, catalog and watcher changes as `MigentChange` |
| Watcher ownership | [watcher.ts](../src/vscode/watcher.ts), [watchBackend.ts](../src/vscode/watchBackend.ts) | Creates, diffs and disposes `FileSystemWatcher`s from core's plan; routes events; reads no detail data |
| Sessions view | [sessionsTree.ts](../src/vscode/views/sessionsTree.ts), [sessionChildren.ts](../src/vscode/views/sessionChildren.ts), [nodes.ts](../src/vscode/views/nodes.ts) | Identity-only nodes, `TreeItem`s built from the live store, children read on expand with core readers, narrow batched refreshes, badge, watch targets retained while a node is expanded; no file-system calls of its own |
| Row text and ids | [sessionPresentation.ts](../src/core/sessionPresentation.ts) | Pure label, description, tooltip, `contextValue`, icon and node-id rules |
| Session commands | [sessionCommands.ts](../src/vscode/commands/sessionCommands.ts), [pick.ts](../src/vscode/pick.ts) | Open files, copy id, reveal, Show more; a Command Palette call picks its target |
| Event tails, timeline and log | [tails.ts](../src/vscode/tails.ts), [sessionDocs.ts](../src/vscode/content/sessionDocs.ts), [channels.ts](../src/vscode/log/channels.ts), [timelineCommands.ts](../src/vscode/commands/timelineCommands.ts) | `TailManager` reference-counts interest per session and owns the `EventTail`; with no holder there is no tail. `migent-session:/<id>/timeline?project=` documents hold interest while a tab shows them. At most 5 `LogOutputChannel`s, least recently shown disposed first; a channel follows the tail only while its session is Running, with a final read when it stops. `migent.session.showTimeline` and `showLog` |
| Window context keys | [contextKeys.ts](../src/vscode/contextKeys.ts) | `migent.hasProjects`, `migent.sessionsState`, `migent.cliState` |
| CLI location and version | [locate.ts](../src/cli/locate.ts), [version.ts](../src/cli/version.ts), [capabilityText.ts](../src/cli/capabilityText.ts) | No `vscode` import. `migent.cli.path` resolves to a shell-free `LaunchSpec`: a native executable, or a `.js`/`.mjs`/`.cjs` entry run with `node` from `PATH`; `.cmd`, `.bat`, `.ps1` and other launchers are unsupported. The required version is a constant in `version.ts`, bumped in the release that needs a newer CLI; there is no setting for it |
| CLI capability service | [capability.ts](../src/vscode/capability.ts), [capabilityCommands.ts](../src/vscode/commands/capabilityCommands.ts) | Per-project state (`checking`, `ok`, `missing`, `unsupported`, `old`, `unparsable`, `error`), one `--version` probe per executable, announces `capability` changes; shows a diagnostic node in the Sessions view; `migent.openSettings` and `migent.cli.recheck` |
| Liveness timer | [liveness.ts](../src/core/liveness.ts) | One 10 s timer, alive only while a session is Running; no `vscode` import |
| Session/workflow locations | [paths.ts](../src/core/paths.ts) | Shared path construction and filenames |
| Shared parsed types and supported versions | [model.ts](../src/core/model.ts) | Core data shapes, not the complete upstream schema |
| Manifest and status reads | [manifest.ts](../src/core/manifest.ts), [statusReader.ts](../src/core/statusReader.ts) | Parse files into nullable fields and explicit read outcomes |
| Lock observation and display derivation | [lockProbe.ts](../src/core/lockProbe.ts), [displayState.ts](../src/core/displayState.ts) | Separate process/file observation from pure state selection |
| Execution and workflow summaries | [executions.ts](../src/core/executions.ts), [workflows.ts](../src/core/workflows.ts) | Read lightweight lists; do not execute workflows |
| Project config and workflow catalog | [projectConfig.ts](../src/core/projectConfig.ts), [projectCatalog.ts](../src/core/projectCatalog.ts) | Read `config.yaml` and workflow files for display; independent of the session store |
| Session detail readers | [questions.ts](../src/core/questions.ts), [outputs.ts](../src/core/outputs.ts), [nextWorkflows.ts](../src/core/nextWorkflows.ts), [handoff.ts](../src/core/handoff.ts), [executionFiles.ts](../src/core/executionFiles.ts) | Stateless read side; each call reads the file and keeps nothing |
| Grouping and attention | [attention.ts](../src/core/attention.ts) | Pure group, count and retention-exemption rules |
| Incremental event reads | [eventTail.ts](../src/core/eventTail.ts) | Complete-line parsing, byte offsets, bounded history, truncation reset |
| Timeline text | [timelineFormat.ts](../src/core/timelineFormat.ts) | Event to display line; raw passthrough for unrecognized lines |
| Watch planning and debounce | [watchPlan.ts](../src/core/watchPlan.ts), [coalescer.ts](../src/core/coalescer.ts) | Pure desired watcher set and path classification; keyed debounce with injectable timers. No watcher is created in core |
| Session cache and notifications | [store.ts](../src/core/store.ts) | One project per store; snapshot, lazy reads, change events |

Tests are colocated as `src/core/<module>.test.ts` and `src/cli/<module>.test.ts`. Shared sample data lives in
[fixtures](../src/core/fixtures); testing guidance belongs to [testing.md](testing.md); verification commands and
setup belong to [CONTRIBUTING.md](../CONTRIBUTING.md#verification).

## File-format contract

Migent owns the persisted file formats. The upstream
[session contract](https://github.com/nodeint/migent/blob/HEAD/docs/sessions.md)
is maintained in the Migent repository. Consult the matching upstream revision
when changing a reader. Local supported-version constants and
parsed types live in [model.ts](../src/core/model.ts).
