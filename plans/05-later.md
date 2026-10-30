# Phase 5 (0.2+): Later

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`04-release.md`](./04-release.md).

Items: workflow graph, metrics dashboard, execution diff, JSON schema + autocomplete for `.migent/workflows/*.yaml`, workspace list via a registry service.

## Webview

The read-only Results overview, phase 3a human-question batch form (see [`03a-human-input.md`](./03a-human-input.md)) and phase 3b separate Next step page (see [`03b-downstream-handoff.md`](./03b-downstream-handoff.md)) already use small editor webviews; they are not deferred to this phase. Results keeps its content/native header actions and only adds suggestions; Next step remains separate. This phase adds two other uses:

1. **Workflow graph:** stages, `depends_on`, decision routes, colored by the progress of the selected session. Data is sent by the host (JSON); the webview does not read files.
2. **Metrics dashboard:** tokens, cost, duration per session and per execution from `metrics.json` (present only once a workflow session is `completed`).

Shared webview rules (also apply to Results and phases 3a/3b): CSP `default-src 'none'` + `webview.cspSource`, external scripts (no inline), `localResourceRoots` limited to the extension's relevant `media/` assets, a nonce for scripts, `getState/setState` instead of `retainContextWhenHidden`, and a `WebviewPanelSerializer` to restore after a reload. Use plain HTML or Preact and draw graphs with SVG (see the `artifact-diagramming` skill for how to draw graphs); do not pull in a heavy framework. The host sends state with an increasing sequence number so the webview can discard stale packets. Native task/config/workflow/output editors are not webviews.

## Execution diff

Diff of code-modifying executions: use git (`vscode.git` API or `git diff` by ref).
