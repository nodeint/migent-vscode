# Phase 3b: Downstream handoff

Part of [`vscode-extension.md`](./vscode-extension.md), within **phase 3**, before [`04-release.md`](./04-release.md). Builds on the readers/store in [`01-core.md`](./01-core.md), Results/monitoring in [`02-monitoring.md`](./02-monitoring.md), and the CLI runner and command gates in [`03-control.md`](./03-control.md). It is independent of the human-question form in [`03a-human-input.md`](./03a-human-input.md).

Sources of truth: Migent's [Downstream handoff](../../migent/docs/workflows.md#downstream-handoff) and [Reusable workflow boundaries](../../migent/docs/sessions.md#reusable-workflow-boundaries). Design reference: [`designs/downstream-handoff-ui.html`](../designs/downstream-handoff-ui.html).

## 1. Scope and fixed UX decisions

Let a user start or prepare a new workflow session from a completed source session's published outputs. Show suggestions where the user already checks the result, then open a separate Next step page for the selected handoff.

- **Results stays Results.** Preserve its existing result content, output links, metadata, and header actions **Open result / Task / View log / menu**. Add a compact next-step suggestions section; do not replace the page with a task/context form or a new dashboard.
- Clicking a Completed session row and invoking Open result reach the same Results overview. Opening an individual output still opens the actual file in a normal editor. Explicit Task/View log/menu actions retain their existing behavior and original session target.
- Clicking a suggestion opens a **separate Next step page/tab** for that source/target. Keep Results open. The task editor, artifact mapping, target definition, Run and Prepare belong on Next step, not inline in Results.
- Nothing runs because the source completed, Results opened, a suggestion was selected, or a notification was dismissed. Run/Prepare require an explicit user action.
- Avoid explanatory product copy about frozen workflows, bind timing, snapshots or implementation mechanics. Show labels, actual data, progress, actionable errors and optional provenance only. Do not add generic Session context cards or sidebar tutorials.

Out of scope: automatic workflow chains, a cross-workflow scheduler, editing generated `next.json`, a replacement workflow/config editor, kernel imports, and changing Migent's artifact binding rules.

## 2. Contract and version boundaries

Schema v4 workflows can declare:

```yaml
downstream:
  - workflow: implement
    task: Implement the approved plan.
    artifacts:
      plan: approved_plan
```

`workflow` is a workflow **ID**, not a file path; target IDs are unique within this list. Task is a nonempty one-line default. Optional `artifacts` maps destination context names to declared source output names. Context names start with a letter and contain letters, digits or underscores. The CLI/Doctor validates unsupported fields, duplicate targets, names and output references. Workflow discovery resolves explicit IDs or filename-derived IDs and treats duplicate workflow IDs as an error, not a first-file-wins choice.

| Source | Meaning for the extension |
|---|---|
| Source's frozen workflow | Canonical downstream declaration; do not substitute the current workspace source YAML. |
| Source `status.json.outputs` and published files | Canonical output records/provenance and file links. |
| Source `next.json`, `schema_version: 1` | Presentation of suggestions: `source_session_id`, `next[]`, workflow/task, named output/path mappings and `argv`. It is not authoritative execution configuration. |
| Target's current workflow/config | Loaded by the CLI at target start, not frozen by source completion or Prepare. |
| Target manifest `prior_session_id` | Link from the new session to its completed source. |
| Target manifest `handoff`, `handoff/` and events | Bound context snapshot paths, source output names and SHA-256 provenance, recorded by the CLI at start. |

`next.json` has no hashes and does not freeze the target definition. Its artifact paths are relative to the source session. No file is written when no suggestions exist. A write failure only warns: source completion and its exit status remain successful. `session continue` on an already Completed source regenerates suggestions without dispatching stages.

Editing `next.json` does not change the real handoff. Treat its task/mapping/argv as untrusted display data until reconciled against the documented frozen declaration and published records. Do not execute its command string or arbitrary `argv`; construct supported CLI arguments from validated, bound identities. The CLI remains authoritative for source validation and actual binding.

Keep workflow version 4, next-file version 1 and manifest versions independent. Establish the minimum released CLI supporting this contract using real fixtures; do not invent a version number or broaden every schema reader to version 4. Unsupported/malformed next data disables its launch actions while preserving result/output access.

## 3. Core/store and watcher integration

Add pure readers/models under `core/nextWorkflows.ts` and `core/handoff.ts` for suggestion envelopes, canonical comparison, published-output references, lineage and recorded snapshot provenance. Do not import `vscode` or Migent's kernel.

- Identity: `(project URI, source session id, target workflow id)`. Child identity remains `(project URI, child session id)`; several legitimate children may share the same source/target.
- Model suggestion data separately from readiness: next envelope available/missing/invalid, canonical declaration available, target resolved/missing/invalid, source/output availability, compatible CLI and launch pending. A missing next file must not imply that the source failed or has no downstream declaration.
- Load next metadata for Completed sessions when Results or the relevant tree node opens. Watch `next.json` for create/change/delete and refresh only that session. Follow manifest/status/events changes for child lineage and bind state; load individual snapshot metadata/content on demand.
- Keep an index of observed `prior_session_id` links without requiring every source to be inside the recent-session limit. Resolve a referenced source by its project/session identity on demand. If unavailable, keep the child and its bound snapshots visible with a missing-source diagnostic.
- Expose source → observed children and child → source navigation through store data. Record only observed child relations; never create a fictitious child because a command was clicked.
- Watch current target workflow definitions through the existing workflow catalog. Updates change readiness/paths without modifying the source's frozen suggestions, losing task edits or moving focus.
- Filesystem events flow watcher → store → views. Commands have separate transient operation state; they do not fabricate Completed, Prepared, Running or bound snapshots.

Results and read-only next/provenance inspection are phase 2 capabilities. Editable Next step and its Run/Prepare operations ship in phase 3b.

## 4. Results overview: additive next-step suggestions

Command: `migent.session.openResult`. It opens/reuses the existing Results overview for the bound session. Keep `migent.session.openOutput` for opening an individual real output file.

Append a next-step section to the normal result content:

- Each suggestion shows workflow ID, its default task, context names, availability errors if any, and existing child status when relevant. Clicking it opens Next step directly; no extra workflow picker.
- Preserve result artifacts/output links and normal header actions. The header still targets the source even when a suggestion for a not-yet-created target is visible. Opening Task opens the **source** task; View log opens the source log rather than being redirected to Results.
- Tree Next workflows entries are optional shortcuts to the same Next step pages, not a second execution flow. They do not change what clicking the source session opens.
- A completed notification keeps Open result as the entry point. It must not pop up another picker, open Next step automatically or start a target workflow.
- Distinguish no declared downstream, unavailable next metadata and malformed/unsupported metadata. For a missing/write-failed file with a known declaration, offer an explicit Reload suggestions action; keep source Completed and its outputs accessible.
- A small `next.json` file link is sufficient for raw inspection. Do not add paragraphs explaining its internals to the product UI.

Use the existing lightweight Results editor surface. If this foundation is not implemented yet, create a small editor webview for the overview with host-backed links and native header actions; do not replace output file editors. This same foundation supplies the separate Next step view in phase 3b. The overview remains read-only during phase 2.

## 5. Separate Next step page

Commands: `migent.session.openNextStep`, `migent.session.runDownstream`, `migent.session.prepareDownstream`.

Bind the page to `(project, source session, target workflow)` and reuse it for that identity. Title/breadcrumb identify the target and source; a source link and Back to results return to the still-open source overview. Source session header actions **Open result / Task / View log / menu** stay available and keep their source target. Launch actions sit in the page footer and act on the future/created child, not on the source.

Content:

1. **Task:** one-line editable input prefilled from the canonical suggestion. Preserve an override while switching pages or reloading; show Reset to suggested task only as an action. Empty task disables launch. Prepare opens `task.md` in the normal Markdown editor for long tasks.
2. **Context:** compact table of destination name → source output name → source file link. Do not show hashes or claim snapshots exist before the CLI binds them. Do not let users silently change this mapping by editing the suggestion UI.
3. **Target definition:** actual workflow ID and current resolved YAML path; open that file with the normal editor. Missing/ambiguous/invalid target disables Run/Prepare with a concise error and relevant Open workflow/Doctor/Recheck actions.
4. **Observed children:** status, task/title and session link. If a child is already Prepared/Running, prioritize Open task/Open session instead of creating another by accident. Allow an explicit separate Run another session action for legitimate reruns; source/target is not globally unique.

Persistent footer: Back to results, Prepare and Run `<workflow>`. While a launch is pending, disable its duplicate actions and retain the task. Display only meaningful progress/errors; no idle prose about freeze/bind mechanics.

Capture project/source/target across all async steps. A later tree selection, editor switch, workflow rename or another open Next step page cannot redirect a launch. Re-resolve IDs and recheck source/readiness immediately before dispatch; never fall back to a different project or similarly named workflow.

## 6. Run semantics

Run always creates a **new** session. Never resume the Completed source to perform the target's work.

```text
migent session run --workflow <target-id> --prior <completed-source-id>
```

When the task was changed, add `--task <override>` as its own argv value. A matching canonical suggestion supplies the default task/artifact mapping when no override is given. Do not concatenate a shell command or quote arguments manually. Use the bound project cwd and the existing CLI/environment settings and runner.

Before dispatch:

- Confirm the source is still Completed, the suggestion still refers to the selected target and the current target ID resolves unambiguously. Save a dirty target workflow document bound to this launch, as for phase 3's per-workflow Run; abort on save failure. Do not Save All unrelated editor buffers.
- Refresh source output records/file availability for useful diagnostics. Do not snapshot files, calculate authoritative hashes, write manifest provenance or duplicate engine binding rules in the extension; the CLI does that at target start.
- Acquire a transient local launch gate scoped to the source/target launch intent across Results, Next step, tree and Palette actions. Hold it until reconciliation determines whether a child was created. Other suggestions/sessions stay usable; source state remains Completed throughout.

At start, the CLI loads the current target definition/model configuration, validates source/artifacts, snapshots named context into target `handoff/`, computes hashes and records provenance. Every agent stage receives the bound paths. Resume/retry of that child uses its recorded snapshots, not the producer's mutable files or a newly computed mapping.

After dispatch, reconcile the actual new session and open/link it. Before a child ID is confirmed, show Starting as a transient launch state, not as a made-up session row. If validation fails before any child exists, stay on Next step, preserve the task and show the specific error; do not silently create a Prepared child. If the CLI did create a session before failing, show its actual state and log instead of claiming no child exists.

An arbitrary workflow can also run with `--prior` without a matching suggestion: it requires an explicit task and receives all published outputs under their original names. That is a distinct manual Run with prior flow, not a fallback when a listed suggestion cannot be validated. Keep it outside this first suggestion-driven UI; never silently change from mapped to all-output context.

## 7. Prepare and Save & Run

```text
migent session prepare <title> --workflow <target-id> --prior <completed-source-id>
```

On success, reconcile the real Prepared session, open its real `task.md` in the normal Markdown editor, and populate/preserve the task the user chose. No custom task textarea/webview editor in the extension. If writing the initial task fails, show that error and retain the Prepared session; do not auto-run it.

Prepare records the prior source ID. It does **not** snapshot context, compute hashes, freeze the target workflow/model, or promise that the source artifacts will still be available when started. The UI shows the source relation and source files, with no invented bound provenance.

Save & Run saves and validates that child session's task, then invokes:

```text
migent session run --session <prepared-child-id> --workflow <target-id>
```

The CLI binds the recorded prior using current workflow/model settings at this point. The child's manually edited `task.md` remains the task; downstream defaults must not overwrite it. Reconcile source/target identity from the prepared session, not whichever Results/Next step page is now selected.

A failed bind leaves the session Prepared. Keep `task.md` open with its contents, report the error and permit an explicit retry after correction. Do not mark it Running/bound or discard the draft. Once bound, subsequent child continuation must not rebind or re-copy the source context.

## 8. Missing next.json and recovery

The extension never recreates `next.json` itself. On explicit Reload suggestions, first recheck that the source is Completed, then call the documented `migent session continue <source-id>` path and reconcile its regenerated suggestions. This special completed-session operation dispatches no source stages under the contract; it is not the downstream Run action. Gate duplicate regeneration requests and surface errors without changing completion.

Do not regenerate on every activation, poll continuously while idle, or interpret missing next metadata as a failed source run. If the frozen workflow has no downstream entries, show the normal empty state without offering pointless regeneration. If canonical information is unavailable for a legacy/corrupt source, preserve raw files/output access and explain that limitation rather than inferring mappings from the current workspace workflow.

On lost acknowledgment or window reload after Run/Prepare, reconcile before retrying. Persist launch identity, task snapshot, known child IDs before the request, and any returned child identity in extension-owned storage outside `.migent/sessions/`. Use the CLI's documented identity output where available and validate it against observed manifest/status data. Do not assume `--json` exists for an operation without verifying the published CLI.

If multiple new candidates share the same prior/target and correlation is ambiguous, show the observed sessions and require the user to choose/open one; do not pick the newest and automatically resend. Local gates prevent duplicate clicks in this extension instance, not exactly-once creation across independent clients. Reopening Results/Next step never relaunches a workflow.

## 9. Lineage, snapshots and view state

- Source Results lists observed downstream child sessions. Child tree/view exposes a source-session link from `prior_session_id`. Source and child navigation preserve selection/expanded state and do not close the other editor.
- After binding, context links open the child's actual snapshot files. Keep the original output reference available in optional provenance details with the recorded SHA-256. Show only metadata the CLI persisted, not hashes guessed from `next.json` or recomputed from current source files.
- Legacy sessions without handoff records retain their documented live-context behavior; do not label that context an immutable snapshot or invent missing provenance.
- Deleting/changing the source after a successful bind must not invalidate the child's already bound snapshot view. Deleted/unreadable snapshot files get a diagnostic; do not silently substitute a fresh source file.
- Store unsent task overrides per `(project URI, source session id, target workflow id)` with the canonical suggestion fingerprint. If its task/mapping changes, preserve the local override and show the relevant difference before dispatch; do not silently reset user input.
- Reconcile background state without replacing an actively edited task/input, changing focus or navigating Results to Next step. Retain existing child operation gates from phase 3 and normal question/blocker handling inside the newly launched workflow.

## 10. UI boundary and error handling

Results/Next step share a lightweight editor-view host; they are separate bound pages, not a combined form and not a new workflow graph. Host-backed native title/header actions and actual file editors remain intact. Use the same CSP, external-script, resource-root, revisioned-message, serialization and theme/accessibility rules as phase 3a/phase 5 webviews.

Webview messages carry source/target identity, view revision and a supported intent, not executable/cwd/path/argv values chosen by the page. Host validates input, derives safe output/snapshot links within the relevant session roots, rechecks source/target/capability, and dispatches the CLI without a shell. Do not execute `next.json.argv`, rendered Markdown/HTML or arbitrary file links as commands. Render task/paths as inert text.

Errors identify the actual missing target/output, save failure, bind failure or uncertain child creation, with the appropriate Recheck/Open file/Doctor/View log action. Keep source Completed unless the store genuinely says otherwise. Preserve overrides/prepared tasks. No generic explanation paragraphs, duplicate success cards or instructions telling developers how to use ordinary controls.

## 11. Implementation and tests

1. **Contract/readers:** add next/handoff models, schema-aware readers, canonical comparison, lineage index and fixtures. Confirm the published CLI's flags/identity outputs and the manifest handoff shape without importing the kernel.
2. **Monitoring/Results:** targeted watchers, Completed-row/Open result routing, preserved result/header controls, additive suggestions, actual output links, raw next inspection and child/source links.
3. **Next step:** separate page identity/tab, captured targets, task overrides, artifact table, current target YAML link, existing-child actions and no extra product copy.
4. **Commands/recovery:** Run/Prepare/Save & Run with prior, launch gates, observed-child reconciliation, missing-next regeneration and uncertain-result recovery.
5. **Release validation:** real CLI/fake-provider fixtures plus Windows, reload, multi-root and UI regression tests.

Required coverage:

- Workflow v4 downstream with optional artifacts, missing/duplicate target IDs, explicit ID differing from filename, invalid task/context names/output references, unknown next schema, tampered `argv`/paths/tasks/mapping, and frozen source declarations differing from the current workspace source YAML.
- Results retains its existing content and **Open result / Task / View log / menu**. Session click/Open result reach Results plus suggestions; selecting a suggestion opens a separate Next step tab. Returning does not lose result state or task overrides. No Run/Prepare form is inserted into Results.
- No automatic launch on completion, notification, Results selection, suggestion selection or reload. Repeated clicks across UI entry points create one local launch; a user can explicitly create another legitimate session later.
- Default/overridden task, whitespace-only task, quotes/spaces/Unicode in argv, target YAML save failure, current target/model settings at actual start, multiple projects with the same workflow/session IDs, and captured targets surviving selection changes.
- Named output mappings/source links, direct Run validation failure before creation, CLI-created child followed by failure, Prepared without snapshots, task population/save failures, failed bind remaining Prepared, manual task preservation and successful later retry.
- Snapshot/provenance records at start, stable child context after source edits/deletion, missing snapshot errors without live-source substitution, legacy live context and correct source/child navigation beyond the recent-session limit.
- Missing next file with/without a downstream declaration, generation warning without changing source completion, explicit completed-source regeneration without stage dispatch, inspection/read-only behavior without CLI, corrupt sources and unsupported versions.
- Disconnect/reload after dispatch before acknowledgment, multiple clients creating children, ambiguous child correlation, no blind retries, no binding twice on child resume, pending human questions/blockers in downstream workflows and no duplicate dispatch after reload.
- Keyboard/screen-reader use, accessible state/errors, preserved focus, hostile webview messages/content and regression of native task/config/workflow editors.

## Done when

- Completed-session click and Open result preserve the normal Results page/header and add usable downstream suggestions.
- A suggestion opens its own Next step page; task/context preview and Run/Prepare work there without replacing Results.
- A real CLI run creates a separate child with the correct `prior_session_id`, mapped artifacts and recorded snapshots/provenance; the source stays Completed.
- Prepare defers binding/freezing, opens a normal `task.md`, and preserves manual content through failed bind and successful Save & Run.
- Missing/modified next metadata cannot change engine binding or source completion. Unknown/uncertain launches are reconciled without automatic resend.
- The UI contains concise actions/data/errors, with no explanatory handoff tutorial copy and no lost header controls.

The [interaction prototype](../designs/downstream-handoff-ui.html) is a design reference only: its browser data, simulated hashes and timing do not replace the real CLI/store contracts or the tests above.
