# Migent for VS Code

Monitor and run [Migent](https://github.com/nodeint/migent) sessions and workflows from VS Code.

Status: monitoring is available (read-only). Running and controlling sessions from VS Code is roadmap work; see
[plans/vscode-extension.md](plans/vscode-extension.md) for the design and roadmap.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, Git workflow, CI, and releases.

```bash
pnpm install
pnpm build
pnpm test
```

Press F5 to launch an Extension Development Host.

## Monitoring

Open a workspace folder that contains `.migent/`. The Migent activity bar container then shows:

- **Sessions**: sessions grouped by state (Running, Needs attention, Recent), including Question and Unknown
  states with their reason, and the executions, files, outputs and questions of each session. A Completed session
  opens a read-only Results page. Click **Show more** to go beyond `migent.sessions.limit`.
- **Workflows** and **Project**: the workflows and `config.yaml` of the project, including invalid ones with
  their error. Each opens in the native editor.
- **Timeline and logs**: `Migent: Show Timeline` and `Migent: Show Log` follow a session's `events.jsonl` live.
- **Status bar**: running and needs-attention counts.

Views update from file changes without Refresh; **Migent: Refresh** re-reads everything if an update was missed.
The extension only reads `.migent/` and never creates or modifies files there. With nothing running and no
timeline or log open it runs no timers or background processes.

If `files.watcherExclude` contains `**/.migent/**`, VS Code delivers no file events for `.migent` and the views
update only on Refresh; remove that entry for live updates.

Settings: `migent.cli.path` and `migent.sessions.limit` (default 50).

## CLI requirement

The extension reads sessions from disk without the CLI; the CLI is checked so later phases can run it.
Set `migent.cli.path` to a native `migent.exe` or to the CLI's JavaScript entry (run with `node` from
`PATH`). `.cmd`, `.bat` and `.ps1` launchers, such as an npm shim, are not supported. The extension needs
CLI 0.3.1 or newer; that minimum is fixed in each extension release and is not a setting.
