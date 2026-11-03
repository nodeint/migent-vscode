import { inspect } from 'node:util';

export default async function* failureReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const { name, file, details } = event.data;
    // Node emits an additional parent failure for failing child tests.
    if (details.error?.failureType === 'subtestsFailed') continue;
    yield `FAIL ${file ?? 'node:test'} > ${name}\n${inspect(details.error, { depth: 8 })}\n`;
  }
}
