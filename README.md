# Migent for VS Code

Monitor and run multi-stage AI workflows and agent sessions directly from your editor.

---

## What is Migent?

[Migent](https://github.com/nodeint/migent) is an orchestration engine for AI-assisted software development and
automated coding workflows. Instead of treating AI as a simple one-shot chat, Migent structures complex development
tasks into reproducible, multi-stage workflows—spanning code migration, automated refactoring, multi-turn agent
execution, deterministic verification, and human-in-the-loop decision checkpoints.

## Why Migent for VS Code?

Running multi-stage AI workflows from a terminal often leads to constant context switching:

- Sessions run in the background, but tracking execution progress requires tailing log files.
- When an AI agent needs human guidance or hits an obstacle, you might not notice until you check the CLI.
- Inspecting generated code, prompts, and model responses forces you to hunt through hidden `.migent/` directories.

**Migent for VS Code** integrates your AI workflows directly into your primary coding environment:

- **Real-Time Visibility**: Track the status of every session (*Running*, *Needs attention*, *Completed*) at a
  glance from the Activity Bar and Status Bar.
- **Live Event & Log Streaming**: Follow agent execution step-by-step with live timelines and dedicated log
  channels side-by-side with your code.
- **Human-in-the-Loop Awareness**: Immediately spot when a session pauses for developer input or hits a
  diagnostic state, so agents are never left waiting.
- **Instant Artifact & Prompt Inspection**: Open generated files, prompts, agent responses, and session outputs
  in native VS Code editors with a single click.
- **Zero Friction & Non-Intrusive**: Works seamlessly alongside the Migent CLI. It reads directly from `.migent/`
  on disk without proprietary background daemons or hidden lock-ins.

---

> **Status**: Monitoring and interactive session execution are available.

---

## Core Capabilities

- **Session Explorer**: Browse all project sessions categorized by status. Expand any session to inspect its
  individual stage executions, generated outputs, modified files, and human-input questions.
- **Live Timeline & Log Streaming**: Run `Migent: Show Session Timeline` or `Migent: Show Session Log` to watch
  events stream live as agents work.
- **Project & Workflow Catalog**: View available workflow definitions and project configuration (`config.yaml`)
  with instant validation for syntax and schema errors.
- **Results View**: Open a comprehensive overview for completed sessions to inspect final outcomes, outputs,
  and downstream workflow suggestions, with the main actions in the page header.
- **Session Controls**: Run or prepare workflows, start, continue, stop, and repair sessions, or run the next stage once.
- **Human Input**: Answer questions and reply to blocked sessions with drafts preserved across reloads. Notifications
  cover questions, blocked and failed sessions, quota waits, and completed sessions.
- **Next Steps**: Run or prepare a suggested workflow using a completed session's outputs.
- **Project Tools**: Initialize a project and run Doctor from VS Code.

## Quick Start

1. Open any workspace containing a `.migent/` directory.
2. Click the **Migent** icon in the Activity Bar.
3. Your active sessions, logs, and workflows appear automatically.
4. Select **Run** on a workflow to start a session, or use `Migent: Initialize Project` to set up a new project.

### Prerequisites

- A workspace containing a `.migent/` project directory.
- *(Optional for monitoring, required for CLI execution)* [Migent CLI](https://github.com/nodeint/migent#readme)
  v0.3.1 or newer.
  - Supported launchers: native binary (`migent.exe`) or Node script entry (`.js`, `.mjs`, `.cjs` via `node` on `PATH`).
  - Shell wrapper scripts (`.cmd`, `.bat`, `.ps1`) are not supported.

## Extension Settings

Configure the extension via VS Code settings (`Ctrl+,` or `Cmd+,`):

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `migent.cli.path` | `string` | `"migent"` | Path or name of the Migent CLI binary or Node script entry. |
| `migent.sessions.limit` | `number` | `50` | Maximum number of recent sessions to display in the Sessions view. |

## Commands

Access these commands through the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Title | Description |
| :--- | :--- | :--- |
| `migent.refresh` | `Migent: Refresh` | Re-read sessions and workflow definitions from disk. |
| `migent.session.showTimeline` | `Migent: Show Session Timeline` | Follow live event timeline for the selected session. |
| `migent.session.showLog` | `Migent: Show Session Log` | Stream live logs for the selected session. |
| `migent.session.openResult` | `Migent: Open Result` | Open the read-only Results page for a completed session. |
| `migent.openConfig` | `Migent: Open Project Config` | Open the project `config.yaml` in the editor. |
| `migent.openSettings` | `Migent: Open CLI Settings` | Open VS Code settings for Migent. |
| `migent.cli.recheck` | `Migent: Recheck CLI` | Validate CLI installation and version compatibility. |

## Troubleshooting

- **Views not updating automatically**:
  Check if `files.watcherExclude` in your VS Code settings includes `**/.migent/**`. If excluded, VS Code will not
  deliver file change events for `.migent/`, requiring manual refreshes. Remove that pattern to restore live updates.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for developer environment setup, coding guidelines, CI, and releases.

```bash
pnpm install
pnpm build
pnpm test
```
