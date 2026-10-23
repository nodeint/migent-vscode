# Phase 4: Polish and release 0.1

Part of [`vscode-extension.md`](./vscode-extension.md). Previous: [`03-control.md`](./03-control.md). Next: [`05-later.md`](./05-later.md).

## Scope

- Multi-root (each folder containing `.migent/` is its own project; group root in the tree).
- Settings review, `migent doctor`, `migent init` in the UI.
- README (including the note about `files.watcherExclude`), icon, screenshots, CHANGELOG.
- The **Workflows** TreeView: lists `.migent/workflows/`; click to open the YAML, with a Run button.
- Packaging and publishing: `vsce package` → VS Code Marketplace and Open VSX. Publisher `nodeint` must exist on both registries first (see Decisions).
- Remote (SSH / WSL / Dev Containers): set `extensionKind: ["workspace"]`, test once on WSL, and document that the CLI must be installed on the remote machine.

## Testing

- **Unit (`core/`):** vitest, building temp directories from fixtures, no VS Code needed.
- **Integration:** `@vscode/test-electron` opens a sample workspace containing `.migent`, checks that the tree appears, commands are registered, and state changes when fixture files are edited.
- **Contract:** a test that reads sessions produced by a real migent (CI runs a workflow with a fake provider, or a script refreshes fixtures when migent changes version) to detect format drift.
- **Windows** is a mandatory CI environment because the main risks are there.
- Manual checklist: Windows, macOS, Linux, Remote-SSH/WSL.

## Done when

- A `.vsix` built by CI installs cleanly and passes the manual checklist on all platforms.
- 0.1 is published to both registries.
