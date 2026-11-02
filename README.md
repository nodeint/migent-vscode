# Migent for VS Code

Monitor and run [Migent](https://github.com/nodeint/migent) sessions and workflows from VS Code.

Status: scaffold. See [plans/vscode-extension.md](plans/vscode-extension.md) for the design and roadmap.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, Git workflow, CI, and releases.

```
pnpm install
pnpm build
pnpm test
```

Press F5 to launch an Extension Development Host.

## CLI requirement

The extension reads sessions from disk without the CLI; the CLI is checked so later phases can run it.
Set `migent.cli.path` to a native `migent.exe` or to the CLI's JavaScript entry (run with `node` from
`PATH`). `.cmd`, `.bat` and `.ps1` launchers, such as an npm shim, are not supported. The extension needs
CLI 0.3.1 or newer; that minimum is fixed in each extension release and is not a setting.
