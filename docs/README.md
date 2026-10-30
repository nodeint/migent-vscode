# Documentation

## Start here

This is the repository's documentation load map. Classify the task, open every matching entry below,
then follow only the matching routes in each local README. Read the linked detailed documents those routes require;
stop when they cover the task. For work that crosses areas, follow the union of those routes.

| Task or question | Open first | Then follow |
| :--- | :--- | :--- |
| Writing, editing, or organizing documentation | [doc-authoring.md](doc-authoring.md) | Also follow the routes for the subject being documented |
| Runtime boundaries, data flow, or module ownership | [architecture.md](architecture.md) | Follow the relevant module group and contract references |
| Session state, locks, file readers, store refresh, or event tail behavior | [core.md](core.md) | Follow the behavior section and its linked implementation/tests |
| Contribution setup, Git branches/hooks, issues, PRs, CI, or extension releases | [CONTRIBUTING.md](../CONTRIBUTING.md) | Follow the relevant setup, verification, PR, or release section |


Standards and guides have separate roles: standards define requirements; guides describe procedures.
Use both when a task requires a procedure governed by a standard.

Documentation scope, maintenance, and verification rules live in
[doc-authoring.md](doc-authoring.md).
