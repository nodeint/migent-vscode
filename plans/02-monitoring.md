# Phase 2: Monitoring (read-only MVP)

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`01-core.md`](./01-core.md). Next: [`03-control.md`](./03-control.md).

## Scope

Activation, `projects`, watcher, Sessions and Workflows trees, Project/config access, welcome view, status bar, file-opening commands (`openTask/Prompt/Response/Output`, `openConfig`, `workflow.open`), Output Channel, timeline document, `copyId`, `refresh`, and the CLI version check. Listing workflows and opening YAML files belong to monitoring; running a workflow arrives in phase 3.

Also includes the read-only Results overview, downstream suggestion metadata and observed source/child lineage described in [`03b-downstream-handoff.md`](./03b-downstream-handoff.md). Run/Prepare and the interactive separate Next step page arrive in phase 3b.

## 1. Watcher (`vscode/watcher.ts`)

- One `FileSystemWatcher` per project: glob `.migent/sessions/*/{manifest.yaml,status.json,session.lock,cancel.requested,questions.json,next.json}` and `.migent/sessions/*/executions/*/{execution.json,questions.json}`. The `.migent` directory is often hidden by the user's `files.watcherExclude`; use `RelativePattern` on concrete paths and verify during Windows testing.
- Coalesce events with a 150ms debounce per session. Each time, re-read that session only, not the whole directory.
- A 10-second timer runs only while at least one session is Running: it re-checks `lockProbe` to catch dead locks that emit no file event (hard-killed process).
- Tail events only for sessions whose log is open or that are Running, to save resources.
- Also watch `.migent/config.yaml` and `.migent/workflows/*.yaml` for create/change/delete. Re-read only the affected project metadata/file and publish a store update; config/workflow changes must not reload every session or steal editor focus. Invalid YAML remains visible with its parse error and an action to open the original file.

## 2. Activity Bar: "Migent" container

**Sessions** (TreeView):

- Group root (when multi-root has several projects): project name.
- Groups by state: **Running**, **Needs attention** (Question, Blocked, Failed, Stopped), **Recent** (Completed, Cancelled, Prepared). Empty groups are hidden. Running sessions with pending questions stay in Running with an attention indicator; never duplicate the same session across groups.
- Session: label = `title` (truncated at ~60 characters, full text in the tooltip), `description` = `workflow · current stage · elapsed time`, icon by displayState.
- Tooltip and timeline keep the latest known blocker/failure summary, stage/attempt, last event time and exact response/verify links. Quota waits show retry time (with timezone) when provided; do not infer a human question from displayState alone. Missing reasons are labeled unavailable, with a link to the log.
- Children of a session: executions in `execution_order` (`plan · attempt 2`), `description` = `provider/model · decision`, icon by status. Children of an execution: `prompt.md`, `response.md`, `verify`, `artifacts/*` (open the real files).
- An "Outputs" node lists `outputs/*` when the session is Completed.
- Completed-session row click opens the normal Results overview, the same target as Open result. Keep individual output nodes opening actual files. Show read-only next-workflow metadata and observed child/source links when available; a missing/invalid `next.json` does not change the source's Completed state. Do not infer a child before one is observed.
- A pending-questions node groups structured human questions by stage/originating execution, with question count and a read-only summary including context/options. Include it even if another branch makes the session Running or Blocked. Show recorded answers/history on demand and offer Open questions file; phase 3a adds the interactive Answer questions action. Details: [`03a-human-input.md`](./03a-human-input.md).
- A "Show more" item beyond `migent.sessions.limit`.

`contextValue` is composed from displayState, e.g. `session.running`, `session.question`, `session.blocked`, `session.stopped`, `session.completed`, `session.prepared`. State-specific menus can use `when: viewItem =~ /^session\.(stopped|blocked|failed)$/`; question-specific actions must additionally depend on actual pending human batches, including in Running/Blocked sessions, rather than that regex alone.

The view shows a badge with the number of unique sessions that are Blocked, Failed, Question or have pending human questions (`TreeView.badge`). Count each session once even if several conditions apply; tooltip breaks down pending stages/questions separately. Preserve selection, expanded nodes and editor focus when background events update the tree. Session identity includes its project URI, so duplicate ids across projects do not collide.

**Workflows** (TreeView):

- List the existing `.migent/workflows/*.yaml` files, grouped by project when several projects exist. Use workflow id when available, falling back to the filename; the tooltip contains the actual project-relative path. Keep identity tied to the project URI and file URI, not just the workflow id.
- Clicking an item opens the real YAML file in the normal VS Code editor. No custom form, webview, textarea or generated copy. YAML highlighting and editing use the normal editor/language support available in the installation.
- This phase has Open and Refresh only; the per-workflow Run action is introduced in phase 3. Keep browsing available without a working CLI.
- Distinguish an empty workflow directory from unreadable files/invalid YAML. An invalid workflow still opens for correction; do not silently omit it. Creating, renaming or deleting a file updates the list through the watcher.

**Project** (TreeView):

- Show `config.yaml` from `.migent/config.yaml`, under its project root when needed. Clicking opens that exact file in the normal YAML editor; if absent, show an unavailable item with the expected path rather than opening an empty file or creating one.
- Migent project config is separate from extension Settings (`migent.*` in VS Code settings.json). The extension does not copy project config into Settings or provide a second configuration form.
- Users can edit/save these source files normally. "Read-only MVP" means no extension-issued workflow/control operations; it does not replace the native editors with read-only documents. Unknown/invalid YAML stays inspectable without inferred defaults or silent rewrites.

**Welcome view** when there is no `.migent` or no sessions. Missing/incompatible CLI shows a capability explanation and install instructions; retain any sessions that can be read from disk. In this phase only "Install CLI" (instructions) is live; "Initialize project" and "Run workflow" arrive in phase 3. Distinguish an empty project from a read/parse error; show Refresh/diagnostics for the latter rather than claiming there are no sessions.

Views never read the disk themselves: data flows **watcher → store → view**.

## 3. Viewing content

**Results:** `migent.session.openResult` opens/reuses the existing result overview, retaining its normal content, output links and header actions **Open result / Task / View log / menu**. Add a compact next-step suggestions section only. Phase 2 exposes read-only metadata/raw-file/target-definition inspection; phase 3b wires each suggestion to a **separate Next step page**. Do not put a task/Run/Prepare form inside Results or replace its header. Keep Task/View log targeting the source session. The read-only overview can use the small host-backed Results editor surface specified in phase 3b; actual task/config/output files stay native editors.

- `prompt.md`, `response.md`, `task.md`, `artifacts/*`, `outputs/*`: open the real files on disk. No copies are made.
- `.migent/config.yaml` and `.migent/workflows/*.yaml`: open the real files in native editors directly from Project/Workflows, without switching to Explorer. These views remain useful even when there are no sessions; the Sessions welcome view must not hide them.
- **Aggregated session log** (`migent-session:/<id>/timeline`): a `TextDocumentContentProvider` renders `events.jsonl` into readable lines (`10:15:30 plan#1 started · codex/gpt-5`), with `onDidChange` when the file changes.
- Session/execution `questions.json`: open the actual generated files for inspection, with no extension writes. Structured summaries/history come through the store, not prose parsing of `response.md`. Unknown question schema disables question actions only and remains inspectable.
- `next.json`, recorded handoff provenance and source/child links: read through the store, preserve raw inspection on error, and load snapshots on demand. Missing next metadata is distinct from no downstream declaration. Phase 2 Refresh only re-reads; CLI regeneration of suggestions is an explicit phase 3b operation.
- **Output Channel** (per-session `LogOutputChannel`). In this phase it is fed by the event tail for sessions started elsewhere.

## 4. Status bar

Left: `$(sync~spin) Migent: 2 running · 1 needs attention` when both exist, otherwise the applicable count; click to focus the Sessions view. Tooltip breaks down pending human questions, Blocked/Failed and projects. Hidden when there is nothing to report. Running sessions must not conceal sessions needing attention.

## 5. CLI version check

`migent --version` ≥ the minimum version (`migent.cli.minVersion`). If the CLI is missing or too old, show install instructions, detected/required versions where known, and the configured executable path. Switch writes to read-only while retaining disk-based monitoring; offer Open Settings and Recheck. If `session cancel` is missing, hide the Stop button (relevant from phase 3).

## 6. Settings introduced

`migent.cli.path`, `migent.cli.minVersion`, `migent.sessions.limit`.

## Commands introduced

`migent.session.openResult`, `openTask`, `openPrompt`, `openResponse`, `openOutput`, `openQuestions`, `showLog`, `copyId`, `revealInExplorer`, `migent.openConfig`, `migent.workflow.open`, `migent.refresh`, `migent.openSettings`.

## Done when

- Opening the migent repo shows the existing sessions with the correct states.
- Running `migent session run` in another terminal makes the session appear as Running and change state at the right time without a refresh.
- Project config and every workflow can be opened from the Migent sidebar in native YAML editors, including when the CLI is missing or there are no sessions.
- Workflow create/rename/delete and config edits update only the affected project metadata. Invalid YAML remains visible and openable; tree expansion and editor focus survive updates.
- Pending human questions/history remain visible in Question, Blocked and Running sessions, with unique-session attention counts and file access even without a compatible CLI.
- Completed-session click/Open result retain result content and all existing header actions while showing read-only downstream suggestions. Output files still open normally; missing next metadata never hides outputs or marks the source failed.
- No CPU usage when idle.

## Interactive preview

Open [`designs/02-monitoring-ui.html`](../designs/02-monitoring-ui.html), keeping [`project-files-ui.js`](../designs/project-files-ui.js) alongside it. Workflows and Project stay visible independently of the session list. YAML highlighting/editing is simulated in the browser; saving changes only demo data in memory, not repository files. The real extension opens the original files in native VS Code editors. All previews are indexed in [`designs/README.md`](../designs/README.md).
