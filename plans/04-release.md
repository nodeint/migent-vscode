# Phase 4: Polish and release 0.1

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`03-control.md`](./03-control.md), including [`03a-human-input.md`](./03a-human-input.md) and [`03b-downstream-handoff.md`](./03b-downstream-handoff.md). Next: [`05-later.md`](./05-later.md).

## Scope

- Multi-root (each folder containing `.migent/` is its own project; group root in the tree).
- Settings review, `migent doctor`, `migent init` in the UI.
- README (including the note about `files.watcherExclude`), icon, screenshots, CHANGELOG.
- Polish and verify the existing **Workflows** and **Project** views (introduced in phase 2), including native YAML opening and the per-workflow Run action from phase 3. Cover multi-root targets, empty/error states and updates after file edits.
- Packaging and publishing: `vsce package` → VS Code Marketplace and Open VSX. Publisher `nodeint` must exist on both registries first (see Decisions).
- Remote (SSH / WSL / Dev Containers): set `extensionKind: ["workspace"]`, test once on WSL, and document that the CLI must be installed on the remote machine.

## Testing

- **Unit (`core/`):** vitest, building temp directories from fixtures, no VS Code needed.
- **Integration:** `@vscode/test-electron` opens a sample workspace containing `.migent`, checks that the tree appears, commands are registered, and state changes when fixture files are edited.
- **Contract:** a test that reads sessions produced by a real migent (CI runs a workflow with a fake provider, or a script refreshes fixtures when migent changes version) to detect format drift.
- **Windows** is a mandatory CI environment because the main risks are there.
- Manual checklist: Windows, macOS, Linux, Remote-SSH/WSL.
- Human input release checklist: real `ask: human` workflow and standalone role session; mixed Running/Blocked questions; complete batch submission; draft reload/reconnect; recorded answers with failed continuation; follow-up/superseded batches; accessibility and webview message validation. Resolve the contract checks/limitations tracked in phase 3a rather than treating the interaction prototype as protocol coverage.
- Downstream release checklist: Results content/header regression and separate Next step navigation; real source completion → explicit Run/Prepare with prior; current target definition at start; failed bind staying Prepared; recorded snapshot/provenance and stable child context; missing next metadata without source failure; uncertain child reconciliation across reload/multi-root. Verify no automatic downstream launch and no duplicate dispatch.

## Done when

- A `.vsix` built by CI installs cleanly and passes the manual checklist on all platforms.
- 0.1 is published to both registries.
