import { describe, expect, it } from 'vitest';

import { NO_SESSION_META } from './sessionMeta';
import {
  answerHeader,
  metricsHeader,
  resultsHeader,
  type SessionHeader,
  sessionPageTitle,
  workflowHeader,
} from './sessionPageModel';

const HEADER: SessionHeader = {
  availability: 'ok',
  sessionId: 's1',
  title: 'A session',
  state: 'Completed',
  workflowId: 'wf',
  meta: NO_SESSION_META,
};

describe('session page headers', () => {
  it('maps the results and metrics headers unchanged', () => {
    expect(resultsHeader(HEADER)).toEqual(HEADER);
    expect(metricsHeader(HEADER)).toEqual(HEADER);
  });

  it('maps the workflow header and reads Unavailable as unavailable', () => {
    const source = { sessionId: 's1', sessionState: 'Completed', title: 'A session', workflowId: 'wf', meta: NO_SESSION_META };
    expect(workflowHeader(source)).toEqual(HEADER);
    expect(workflowHeader({ ...source, sessionState: 'Unavailable' }).availability).toBe('unavailable');
  });

  it('maps an answer header with the session id the host owns', () => {
    const source = { sessionState: 'Question', title: 'A session', workflowId: 'wf', meta: NO_SESSION_META };
    expect(answerHeader(source, 's1')).toEqual({ ...HEADER, state: 'Question' });
    expect(answerHeader({ ...source, sessionState: 'Unavailable' }, 's1').availability).toBe('unavailable');
  });
});

describe('sessionPageTitle', () => {
  it('shortens a long title and names an unavailable session plainly', () => {
    expect(sessionPageTitle({ ...HEADER, title: 'x'.repeat(40) })).toBe('x'.repeat(31) + '…');
    expect(sessionPageTitle({ ...HEADER, availability: 'unavailable' })).toBe('Session');
  });
});
