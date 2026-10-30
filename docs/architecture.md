# Architecture

This page maps the extension's runtime composition and module responsibilities.
For file-reader and state behavior, see [Core behavior](core.md).

## Current runtime

[extension.ts](../src/extension.ts) registers
`migent.refresh` with an empty handler. The core readers and store exist and are
tested independently; activation does not instantiate them.

Core currently reads session files and workflow summaries directly from disk.
Its implemented composition is:

```text
caller -> SessionStore -> manifest/status/lock readers -> display state
                      -> execution reader (explicit lazy load)
                      -> event tail (explicit incremental read)
caller -> workflow reader -> workflow summaries
```

The store holds an in-memory projection; persisted Migent files remain the source
of truth. Core imports no `vscode` API and does not modify session files.

## Ownership map

| Responsibility | Implementation | Boundary |
| :--- | :--- | :--- |
| Activation and command registration | [extension.ts](../src/extension.ts) | VS Code lifecycle and wiring |
| Session/workflow locations | [paths.ts](../src/core/paths.ts) | Shared path construction and filenames |
| Shared parsed types and supported versions | [model.ts](../src/core/model.ts) | Core data shapes, not the complete upstream schema |
| Manifest and status reads | [manifest.ts](../src/core/manifest.ts), [statusReader.ts](../src/core/statusReader.ts) | Parse files into nullable fields and explicit read outcomes |
| Lock observation and display derivation | [lockProbe.ts](../src/core/lockProbe.ts), [displayState.ts](../src/core/displayState.ts) | Separate process/file observation from pure state selection |
| Execution and workflow summaries | [executions.ts](../src/core/executions.ts), [workflows.ts](../src/core/workflows.ts) | Read lightweight lists; do not execute workflows |
| Incremental event reads | [eventTail.ts](../src/core/eventTail.ts) | Complete-line parsing and byte offsets |
| Session cache and notifications | [store.ts](../src/core/store.ts) | One project per store; snapshot, lazy reads, change events |

Tests are colocated as `src/core/<module>.test.ts`. Shared sample data lives in
[fixtures](../src/core/fixtures); testing guidance belongs to [testing.md](testing.md); verification commands and
setup belong to [CONTRIBUTING.md](../CONTRIBUTING.md#verification).

## File-format contract

Migent owns the persisted file formats. The upstream
[session contract](https://github.com/nodeint/migent/blob/HEAD/docs/sessions.md)
is maintained in the Migent repository. Consult the matching upstream revision
when changing a reader. Local supported-version constants and
parsed types live in [model.ts](../src/core/model.ts).
