# UI designs

Open an HTML file directly in a browser. No build or server is required; keep the JavaScript files in this directory
alongside the HTML files.

| Design | Preview |
| --- | --- |
| Monitoring, sessions, workflows and project config | [02-monitoring-ui.html](./02-monitoring-ui.html) |
| Session controls, tasks, replies and notifications | [03-control-ui.html](./03-control-ui.html) |
| Human question batches | [human-questions-ui.html](./human-questions-ui.html) |
| Results suggestions and separate downstream Next step | [downstream-handoff-ui.html](./downstream-handoff-ui.html) |

These are interaction prototypes with sample data. They do not run Migent or read/write project session files.
Browser storage emulates drafts and selected demo session state; YAML edits change in-memory sample content.
Native VS Code editors and header actions are simulated in HTML.

`03-control-ui.js` supplies shared control behavior; `project-files-ui.js` supplies Project/Workflows and sample YAML
editing. Human-input and downstream previews add their own interaction layers and use separate demo session-storage keys.

The human-question sketch predates the final contract: its text-only fixture and additive multiple-choice/Other behavior
do not reflect the implemented question flow.
