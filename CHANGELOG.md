# Changelog

## Unreleased

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
