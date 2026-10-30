# Testing

Use this guide when selecting and writing tests. Run the checks appropriate to
the change before and after implementation; the
[contribution guide](../CONTRIBUTING.md#verification) lists the commands.

## Select test cases

Write high-value logic cases that protect important behavior and can catch
meaningful regressions. Prioritize:

- Distinct outcomes and critical rules.
- Boundaries and failure handling.
- State transitions where a defect would matter.

Cover the affected behavior and its material risks. A small test count does not
replace verification of an important outcome.

### Keep the suite focused

Choose representative inputs for equivalent cases instead of testing every
combination. Minimize medium-value cases that add little confidence relative to
their maintenance cost. Avoid duplicate cases and tests that merely mirror
implementation details or documentation prose.

## Write assertions

Check observable behavior and ensure each assertion can distinguish a regression
from a correct result.

## Verify behavior changes

Core tests use fixtures and temporary directories without launching VS Code.

For extension commands, activation, or UI changes, also verify the behavior in
VS Code and describe the manual steps in the PR. Automated extension-host
integration tests are not currently configured.
