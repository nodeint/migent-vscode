// The session domain of the page header: which icon and tone each session state gets, the facts every session page
// shows, and the menu of the session. It maps session data onto the kit's `pageHeader`; the kit
// itself knows nothing about sessions. Loaded before session.js (see docs/ui.md). Exposes `MigentSessionHeader`.
(function () {
  'use strict';

  const ui = window.MigentUi;
  const copy = window.MigentCopy;
  const { formatDuration, formatAgo, parseTime } = window.MigentUtils;

  /**
   * Icon, tone and text per session display state. The icon ids are the ones of the Sessions view
   * (DISPLAY_STATE_ICONS), the tones its colors: running blue, question and blocked yellow, failed red,
   * completed green, the rest neutral. The text is always shown too, so color is never the only signal.
   */
  const SESSION_STATES = {
    prepared: { icon: 'circle', tone: 'muted' },
    running: { icon: 'sync', tone: 'info', spin: true },
    blocked: { icon: 'warning', tone: 'warn' },
    question: { icon: 'comment-discussion', tone: 'warn' },
    failed: { icon: 'error', tone: 'error' },
    stopped: { icon: 'debug-pause', tone: 'muted' },
    cancelled: { icon: 'circle-slash', tone: 'muted' },
    completed: { icon: 'pass', tone: 'ok' },
    unknown: { icon: 'question', tone: 'muted' },
  };

  /** `state` is a session state name, or `{ icon, tone, text }` for a page with its own states. */
  function stateBadge(state) {
    if (typeof state !== 'string') return state;
    return { ...(SESSION_STATES[state.toLowerCase()] || SESSION_STATES.unknown), text: state };
  }

  function sessionAction(name) {
    return { intent: 'sessionAction', action: name };
  }

  /**
   * The session facts every session page's header shows, in a fixed order and hidden when unknown: the stage, the
   * duration (to now while running), the time since the last update and the pending questions.
   * `meta` is the model's `SessionMeta`. Returns `[{ icon, text, title?, tone?, live? }]`; `live` re-computes the text.
   */
  function sessionFacts(meta) {
    const created = parseTime(meta.createdAt);
    const updated = parseTime(meta.updatedAt);
    const facts = [];
    if (meta.stageId) facts.push({ icon: 'milestone', text: meta.stageId, title: 'Stage' });
    if (created !== null && (meta.isRunning || updated !== null)) {
      const duration = () => formatDuration((meta.isRunning ? Date.now() : updated) - created);
      facts.push({ icon: 'watch', text: duration(), title: 'Duration', live: meta.isRunning ? duration : null });
    }
    if (updated !== null) {
      const ago = () => formatAgo(Date.now() - updated);
      facts.push({ icon: 'history', text: ago(), title: 'Updated ' + new Date(updated).toLocaleString(), live: ago });
    }
    if (meta.pendingQuestions > 0) {
      facts.push({ icon: 'comment-discussion', text: meta.pendingQuestions + ' pending', title: 'Pending questions', tone: 'warn' });
    }
    return facts;
  }

  /**
   * The session page header, `pageHeader` over the session's data, in four tiers: status badge with the workflow id
   * (`options.workflowId`), the title (at most two lines, full text in its tooltip), metadata and one row with the
   * page tabs followed by the more menu (View log, Copy session ID, Reveal in Explorer, then
   * `options.menuItems`).
   * - `options.state`: a session state name, or `{ icon, tone, text }` for a page with its own states.
   * - Metadata is `options.meta`, the model's `SessionMeta`, and the same on every page (see `sessionFacts`).
   * - `options.tabs` is `[{ key, label, onSelect }]`; the tab whose key is `options.current` is underlined and
   *   needs no `onSelect`.
   * - `options.sendAction(name)` runs a session action; it defaults to `page.send` of a `sessionAction` intent.
   */
  function sessionHeader(page, options) {
    const send = (name) => () => (options.sendAction ? options.sendAction(name) : page.send(sessionAction(name)));
    return ui.pageHeader({
      state: stateBadge(options.state),
      label: options.workflowId,
      title: options.title,
      clamp: true,
      facts: sessionFacts(options.meta),
      tabs: { label: copy.tabsLabel, tabs: options.tabs, current: options.current },
      menu: {
        label: copy.menu.label,
        items: [
          { label: copy.menu.viewLog, onSelect: send('showLog') },
          { label: copy.menu.copySessionId, onSelect: send('copyId') },
          { label: copy.menu.revealInExplorer, onSelect: send('revealInExplorer') },
          ...(options.meta && options.meta.canComplete ? [{ label: copy.menu.completeSession, onSelect: send('completeSession') }] : []),
          ...(options.menuItems || []),
        ],
      },
    });
  }

  window.MigentSessionHeader = { sessionHeader, sessionStates: SESSION_STATES };
})();
