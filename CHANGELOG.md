# Changelog

## Unreleased

- Require Migent CLI 0.5.1. A client quota failure is now an ordinary failed stage that Continue reruns at once, so the
  Retry After Quota Wait command, its expiry reminders and the `migent.notifications.quota` setting are removed. The
  failed notification and the session tooltip name the reset time when the CLI recorded one. A stopped session with a
  quota event from an older CLI shows as an ordinary stopped session.
- Edit and save workflow schema 7 in the workflow editor and on the Session workflow page: a top-level Artifacts
  registry replaces stage `produces` and `outputs`, stages and decisions list artifact ids (a decision may define its
  own artifacts), and a downstream suggestion may omit its artifact mapping. Workflows on any other schema are shown
  read-only with a pointer to `migent migrate`, and both pages refuse to save them.
- Confirm a downstream suggestion against the session's own published outputs when the frozen workflow omits
  `artifacts` or maps an optional artifact that was not published, so those launches are no longer blocked.
- Add a workflow editor page whose Design form edits and saves schema 5 workflows. A stage chooses the role's agent, a
  named agent, or a complete inline agent, and Save validates and writes through
  `migent workflow save --preserve-comments` with a base hash. CLI diagnostics are shown on the page, and an invalid
  draft or a file that changed on disk keeps the draft.
- Make the workflow editor's references closed lists: a stage's named agent, dependencies, resumed session, decision
  destinations, output source and artifact, and downstream workflow and artifact names. A decision chooses exactly one
  destination and never its own stage; an imported route to several stages or to itself stays visible with a warning.
  Changing a stage id updates the references in the draft, and an unknown imported value stays visible instead of
  being rewritten.
- Edit an inline agent's model with one searchable, client-grouped picker shared with initialization, which writes
  the client and model together. Effort stays beside it, native option keys are suggested from
  `migent get options --client <id> --native`, and an imported value the list does not cover stays visible.
- Redesign the workflow editor's Design view around a clearer hierarchy: numbered stage cards whose header shows role,
  agent and instruction chips, with named groups (Identity, Inline agent, Dependencies, Instructions, Decisions,
  Advanced), quiet row actions, and one full-width dashed button to add a row.
- Add a shared form kit, `media/shared/form.js` (`MigentForm`), and matching `base.css` components: fields, grids,
  sections, checkbox lists, string and key/value list editors, compact `hint` tooltips and `button`. Every block uses
  one `mg-section` structure (`mg-section-head`, `mg-section-body`, with `--group`, `--card` and `--surface`
  variants), page section heads stay in view while scrolling, and `MigentPage.details` is the single collapsible
  component with its own chevron. The workflow editor is its first consumer.
- Add the Session workflow page, with a Workflow and Task tab on every session page.
- Require Migent CLI 0.5.0 or newer. Migent 0.5.0 replaced providers with clients: Initialize now lists the
  clients on `PATH` and their models with `get clients` and `get models`, and passes `--client` and
  `--planner-client`/`--reviewer-client`, because 0.5.0 removed `get providers` and the `--provider` flags. Session,
  Results and Session Metrics pages read `client` instead of `provider` from `execution.json`, `status.json` and
  `metrics.json`; sessions written by older Migent versions show no client. The extension supports one minimum CLI
  version: a newer feature bumps that minimum in its release, and an older CLI shows the existing Update Migent CLI
  action instead of a per-feature guard. After upgrading an existing project, run `migent migrate` once:
  `doctor`, `session run`, and `session continue` refuse an older workflow schema (now version 6). The migration
  turns an agent's `provider` into `client.type`.
- Browse every attempt’s full on-disk directory tree in the Sessions view, including arbitrary files and nested
  folders, with live updates while expanded. Remove the attempt context menu; open files directly from the tree.
- Simplify the session context menu by removing Open Result, Open Task, Open Metrics and Reveal Session in File Explorer.

- Require Migent CLI 0.4.0 or newer. The extension supports one minimum CLI version: a newer feature bumps that
  minimum in its release, and an older CLI shows the existing Update Migent CLI action instead of a per-feature
  guard. After upgrading an existing project, run `migent migrate` once: `doctor`, `session run`, and
  `session continue` refuse an older workflow schema. The migration replaces a stage's `model` with `agent` and
  deletes stage `options`, so recreate any needed option as an inline `agent` on that stage.
- Open the `failure.md` report of a failed execution from its attempt in the Sessions view or from the failure
  notification. The report opens read-only and the action appears only when the file exists; `failure.md` and
  `diagnostics.json` are also listed under the attempt.
- Show the editor title actions for reply drafts, session tasks and workflows on Windows too: their resource path
  masks now match both separators, so Send Reply appears for a reply draft and Start or Run for the related files.

## 0.1.3

- Report a failed pre-run check of Migent CLI 0.3.6 (`Preflight failed: ...`, exit 2) as such and point to the log,
  which lists the problems, instead of blaming the session's `workflow.yaml`.
- Show one onboarding action at a time in the Sessions view when no folder has a Migent project: Install or Update
  Migent CLI when the CLI is missing or older than required, Initialize project when it is usable. The CLI is now
  checked for the window, so this works before any project exists.
- Add Install or Update CLI, which runs `npm install -g @nodeint/migent@latest` in a "Migent: Install CLI" terminal and
  rechecks the CLI when it ends.
- Speed up Initialize project: progress shows right after the folder is chosen, the CLI is not probed twice, and one
  model pick covers every role (or choose per role). The success message offers Run workflow.
- When the CLI is missing, the Sessions view shows the install onboarding even in a folder that already has `.migent`.
  While installing, the Install action is replaced by a progress message, and the view updates by itself once the CLI
  works (the CLI is rechecked every few seconds while the install runs).
- Clarify the extension's focus on workflow execution and AI agent orchestration in its description and README,
  update getting-started instructions, commands and settings, and exclude the README screenshot from the VSIX.
- Show only Files and the stage attempts under each session in the Sessions view. The Outputs, Questions and History
  branches are gone: outputs stay on Results, questions are answered from the Questions page, the session's Answer
  Questions action and notifications, and `outputs/` and `questions.json` remain browsable under Files.
- Open the Results page when clicking any session in the Sessions view, whatever its state, and offer Open Result in
  every session's context menu. Remove the Reload suggestions button; existing next-step suggestions are unchanged.
- Add a New session action to the Sessions view title bar: pick the project and workflow once, then Run now (task
  input with Compose in editor) or Prepare (title input, opens `task.md`).
  The workflow picker no longer lists each workflow's stages, and Prepare Session no longer shows a "Session prepared"
  notification.

## 0.1.2

- Support Migent CLI 0.3.5 session drafts: Prepare offers to open the session's `workflow.yaml`, Continue no longer
  reports a workflow change or sends `--refresh-workflow` for a session started from its draft, Save & Run refuses to
  start while `workflow.yaml` has unsaved edits, and a rejected draft is reported against `workflow.yaml` and can be
  fixed and run again.
- Give Results, Session Metrics and Questions one session header (state, workflow, title, session facts, page tabs),
  one set of VS Code icons shared with the Sessions view, and colored editor-tab icons that follow the session state.
- Release the session after a reply once the blocked execution is resumed, instead of waiting for the reply text in
  the conversation, so a changed CLI prompt no longer leaves Submit disabled until the window is reloaded.
- Settle a sent reply or a submitted answer as soon as the session shows it was received, instead of when the CLI
  finishes running the stage.
- Remove the `migent.cli.path` setting and the Open CLI Settings command. The extension now finds `migent` on `PATH`,
  including the npm and pnpm `.cmd` launchers on Windows, whose JavaScript entry it runs with `node`.
- Redesign the Results page with an in-page header (Results and Metrics buttons, more actions), output rows,
  next-step cards and a collapsed Details block.
- Show a read-only Session Metrics page for a completed session, with timing, token usage, cost caveats,
  stage and execution details, opened from Results or the Sessions view.

## 0.1.1

- Browse session files in their directory structure with the active file icon theme.
- Simplify commands and notifications, group recent sessions by date, and allow deleting a session from its context menu.

## 0.1.0

- Add read-only monitoring of Migent sessions, workflows, project configuration, timelines, logs, and results.
- Run, prepare, continue and stop Migent sessions from VS Code, including a Run action on each workflow.
- Answer questions that Migent sessions ask from VS Code, with notifications and a question panel that keeps drafts.
- Start or prepare a new workflow session from a completed session's outputs using suggested next steps on Results and
  a Next step page.
- Reply to blocked sessions with drafts that survive a reload, get notified when a session blocks, fails, waits for
  provider quota or completes, and run the next stage once, continue without a reply, repair a session, run Doctor and
  initialize a project.
