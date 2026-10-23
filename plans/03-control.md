# Phase 3: Control

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`02-monitoring.md`](./02-monitoring.md). Next: [`04-release.md`](./04-release.md).

Prerequisite: [`session-cancel.md`](./session-cancel.md) has landed (the Stop button needs `migent session cancel`).

Scope: `cli/` (locate, invoke, runner, version), the write commands, `withProgress`, and notifications. Decision: processes always survive closing VS Code (detached, no setting). Test early that the `detached` child behaves on Windows (no console window, survives extension host exit).

## 1. Command execution (`cli/`)

- **Short commands** (`--version`, `session show --json`, `prepare`): `execFile` with a timeout, parse JSON, typed errors.
- **Long commands** (`session run`, `session continue`): `spawn` with `windowsHide: true`, `stdio` read (stderr is a line-based log), `detached: true` on POSIX so the process survives a window reload. On Windows, separately verify that the child keeps running after the extension host exits. No shell; pass `argv` directly.
- Environment: inherited from VS Code; extra variables can be set via the `migent.env` setting.
- Result: map the exit code to an enum (`Completed | NotFinished | StageFailed | VerifyExhausted | Quota | Cancelled | ConfigError`), with the `response:` or `verify:` line from stderr so the related file can be opened quickly. Exit codes: 0 done, 1 not finished, 3 stage_failed, 6 verify_exhausted, 7 verify, 8 quota, 130 cancelled.
- Concurrency: `SessionLock` already blocks two processes on the same session, but the extension also checks beforehand (Run/Continue are disabled while Running) to avoid error messages.
- `--max-dispatches` and similar flags come from settings, not from a prompt each time.

Commands call the CLI, and the result comes back through the watcher; commands never update the store directly.

## 2. Commands

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
| `migent.doctor` | `migent doctor --json` shown in Output or a light webview |

Every write command checks: the CLI version is sufficient, no live lock belongs to another process, and the project is not in read-only mode.

Welcome view gains "Initialize project" (`migent init`, driven by Quick Pick prompts) and "Run workflow".

## 3. Progress and notifications

- `window.withProgress` (Notification location, cancellable) for a run started by the extension itself; cancelling calls `session cancel`.
- Notifications (each type can be disabled in settings): Blocked ("Reply" button), Failed ("Continue" / "View log" buttons), Quota (with `retry_at`, and a reminder when it expires), Completed ("Open result" button).
- Only notify on state transitions that happen **after** the extension activates, to avoid a flood when a window opens.
- The per-session Output Channel now also receives stderr lines of commands the extension runs.

## 4. Settings introduced

`migent.run.maxDispatches` (20, passed as `--max-dispatches`), `migent.run.progress` (true, passed as `--progress`), `migent.notifications.*` (blocked / failed / quota / completed), `migent.env` (`{}`).

## 5. Tests

- Mock `child_process` to check arguments, exit-code mapping, `windowsHide`, and line-based stderr handling.
- Integration with a `fake-provider.mjs` like migent's `integration/`.

## Done when

- The `plan` workflow runs end to end from the Command Palette.
- Cancelling midway on Windows yields exit 130 and Continue can resume.
- Reply works for a Blocked session.
- Two places pressing Run at once produce no strange errors.
