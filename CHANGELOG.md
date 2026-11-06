# Changelog

## Unreleased

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

## 0.1.3

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
