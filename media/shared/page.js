// Shared page helpers for Migent webview pages. Loaded before the page's own script (see docs/ui.md).
// Exposes one global, `MigentPage`. Every string is set with textContent; nothing here builds HTML.
(function () {
  'use strict';

  const copy = window.MigentCopy;

  /** Create an element. `text` and `className` are optional. */
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function section(title, className) {
    const node = el('section', null, className);
    node.append(el('h2', title));
    return node;
  }

  let footerObserver = null;

  /**
   * Keep `--mg-footer-height` equal to the rendered height of the page's `.mg-footer` (0 without one). The sticky
   * footer covers the bottom of the viewport, so base.css uses it as `scroll-padding-bottom`: a focused control or
   * a scrolled-to target stops above the footer, also when its buttons wrap to several lines.
   * `connect` calls it after each host model; a page that re-renders on its own calls `MigentPage.trackFooter()`.
   */
  function trackFooter() {
    const footer = document.querySelector('.mg-footer');
    // Read the current footer on every call: a page may replace it between resizes.
    const apply = () => {
      const current = document.querySelector('.mg-footer');
      document.documentElement.style.setProperty('--mg-footer-height', (current ? current.offsetHeight : 0) + 'px');
    };
    apply();
    if (footerObserver) footerObserver.disconnect();
    footerObserver = null;
    if (footer && typeof ResizeObserver !== 'undefined') {
      footerObserver = new ResizeObserver(apply);
      footerObserver.observe(footer);
    }
  }

  /**
   * Connect a page to the extension: one `acquireVsCodeApi` handle, the revision guard, `setState(identity)`
   * and the `ready` handshake. `render(model, transient)` is called for each newer model message; `transient` is
   * the message's optional host state (undefined when the host posts none) and is not part of the model.
   * Returns `{ send, post, button }`. `send(intent)` posts `{ type: 'intent', revision, ...intent }`. `post(message)`
   * posts a message whose `type` the page chose, for a host that validates its own message set; it adds nothing.
   */
  function connect(options) {
    const vscode = acquireVsCodeApi();
    let revision = -1;

    function send(intent) {
      vscode.postMessage({ ...intent, type: 'intent', revision });
    }

    function post(message) {
      vscode.postMessage(message);
    }

    /** A native secondary-looking button that sends `intent` when activated. */
    function button(label, intent, className) {
      const node = el('button', label, className);
      node.type = 'button';
      node.addEventListener('click', () => send(intent));
      return node;
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'model' || typeof message.revision !== 'number') return;
      if (message.revision <= revision) return;
      revision = message.revision;
      vscode.setState(message.identity);
      options.render(message.model, message.transient);
      trackFooter();
    });

    vscode.postMessage({ type: 'ready' });
    return { send, post, button };
  }

  // Open/closed state of <details>, kept in memory so a model re-render does not collapse them.
  const detailsOpen = new Map();

  /**
   * A collapsible block (<details>/<summary>) that stays as the user left it across re-renders.
   * The shared chevron has a box of its own, so a header with chips or a wrapped title keeps the arrow on the
   * first line. `summary` is a string, or a node when the header needs a badge and metadata chips.
   * It starts closed unless `isOpenByDefault` is true and the reader has not toggled it yet. `path` is a
   * `data-path` on the summary, so a repaint can focus the header without opening the block.
   */
  function details(key, summary, className, isOpenByDefault, path) {
    const node = el('details', null, 'mg-details' + (className ? ' ' + className : ''));
    node.open = detailsOpen.has(key) ? detailsOpen.get(key) === true : isOpenByDefault === true;
    const head = el('summary', null, 'mg-details-summary');
    if (path) head.dataset.path = path;
    const arrow = el('span', null, 'mg-details-arrow');
    arrow.append(icon('chevron-down'));
    head.append(arrow);
    const heading = el('div', null, 'mg-details-heading');
    if (typeof summary === 'string') heading.textContent = summary;
    else if (summary) heading.append(summary);
    head.append(heading);
    node.append(head);
    node.addEventListener('toggle', () => detailsOpen.set(key, node.open));
    return node;
  }

  /**
   * Open every collapsible block around `node`, so a control inside a closed card can be focused or scrolled to.
   * The open state is kept by `details`, so the cards stay open across the repaint that follows. A control in a
   * card's own header (its summary) is visible while the card is closed, so that card stays as it is; only the
   * cards around it open.
   */
  function openAround(node) {
    let card = node.closest('details');
    const summary = node.closest('summary');
    if (card && summary && summary.parentElement === card) card = card.parentElement && card.parentElement.closest('details');
    for (; card; card = card.parentElement && card.parentElement.closest('details')) {
      card.open = true;
    }
  }

  let closeOpenMenu = null;
  let menuCount = 0;

  /**
   * A menu button following the WAI-ARIA menu-button pattern.
   * `items` is a list of `{ label, onSelect }`. Enter, Space and ArrowDown open the menu; arrows, Home
   * and End move focus; Escape closes it and returns focus to the trigger; Tab and an outside click close it.
   */
  function menuButton(options) {
    menuCount += 1;
    const menuId = 'mg-menu-' + menuCount;
    const wrapper = el('div', null, 'mg-menu');
    const trigger = el('button', options.label, 'mg-btn mg-btn--secondary');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', menuId);
    if (options.ariaLabel) trigger.setAttribute('aria-label', options.ariaLabel);
    const list = el('div', null, 'mg-menu-list');
    list.id = menuId;
    list.setAttribute('role', 'menu');
    if (options.ariaLabel) list.setAttribute('aria-label', options.ariaLabel);
    list.hidden = true;

    const entries = options.items.map((item) => {
      const entry = el('button', item.label, 'mg-menu-item');
      entry.type = 'button';
      entry.tabIndex = -1;
      entry.setAttribute('role', 'menuitem');
      entry.addEventListener('click', () => {
        close(true);
        item.onSelect();
      });
      list.append(entry);
      return entry;
    });

    function onDocumentClick(event) {
      if (!wrapper.contains(event.target)) close(false);
    }

    function close(shouldRestoreFocus) {
      if (list.hidden) return;
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocumentClick, true);
      if (closeOpenMenu === close) closeOpenMenu = null;
      if (shouldRestoreFocus) trigger.focus();
    }

    function open(focusIndex) {
      if (closeOpenMenu) closeOpenMenu(false);
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      closeOpenMenu = close;
      document.addEventListener('click', onDocumentClick, true);
      const target = entries[focusIndex < 0 ? entries.length - 1 : focusIndex];
      if (target) target.focus();
    }

    trigger.addEventListener('click', () => {
      if (list.hidden) open(0);
      else close(true);
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        open(0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        open(-1);
      } else if (event.key === 'Escape') {
        close(true);
      }
    });
    list.addEventListener('keydown', (event) => {
      const index = entries.indexOf(document.activeElement);
      let next = null;
      if (event.key === 'ArrowDown') next = (index + 1) % entries.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + entries.length) % entries.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = entries.length - 1;
      if (next !== null) {
        event.preventDefault();
        entries[next].focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        close(false);
      }
    });

    wrapper.append(trigger, list);
    return wrapper;
  }

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

  /** A 16x16 codicon drawn in the current text color. An unknown id draws nothing but keeps the box. */
  function icon(name, spin) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'mg-icon' + (spin ? ' mg-icon--spin' : ''));
    svg.setAttribute('aria-hidden', 'true');
    for (const part of (window.MigentIcons || {})[name] || []) {
      const shape = document.createElementNS(ns, 'path');
      shape.setAttribute('d', part.d);
      if (part.evenodd) shape.setAttribute('fill-rule', 'evenodd');
      svg.append(shape);
    }
    return svg;
  }

  /** `state` is a session state name, or `{ icon, tone, text }` for a page with its own states. */
  function statusIndicator(state) {
    const isName = typeof state === 'string';
    const known = isName ? SESSION_STATES[state.toLowerCase()] || SESSION_STATES.unknown : state;
    const node = el('span', null, 'mg-status mg-status--' + known.tone);
    node.append(icon(known.icon, known.spin), el('span', isName ? state : state.text));
    return node;
  }

  function sessionAction(name) {
    return { intent: 'sessionAction', action: name };
  }

  const MS_PER_SECOND = 1000;
  const SECONDS_PER_MINUTE = 60;
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const days = Math.floor(hours / HOURS_PER_DAY);
    if (days > 0) return days + 'd ' + (hours % HOURS_PER_DAY) + 'h';
    if (hours > 0) return hours + 'h ' + (minutes % MINUTES_PER_HOUR) + 'm';
    if (minutes > 0) return minutes + 'm ' + (seconds % SECONDS_PER_MINUTE) + 's';
    return seconds + 's';
  }

  function parseTime(iso) {
    const time = typeof iso === 'string' ? Date.parse(iso) : NaN;
    return Number.isNaN(time) ? null : time;
  }

  const JUST_NOW_MS = 5 * MS_PER_SECOND;

  function formatAgo(ms) {
    return ms < JUST_NOW_MS ? 'just now' : formatDuration(ms).split(' ')[0] + ' ago';
  }

  // Header chips that follow the clock: [{ node, text() }], refreshed twice a minute while the page is open.
  const REFRESH_MS = 30 * MS_PER_SECOND;
  let liveChips = [];
  let refreshTimer = null;

  function refreshLiveChips() {
    for (const chip of liveChips) chip.node.textContent = chip.text();
  }

  function keepFresh() {
    if (refreshTimer === null && typeof setInterval === 'function') refreshTimer = setInterval(refreshLiveChips, REFRESH_MS);
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
   * The header shared by every session page, in four tiers: status badge with the workflow id
   * (`options.workflowId`), the title (at most two lines, full text in its tooltip), metadata and one row with the
   * page tabs followed by the more menu (View log, Copy session ID, Reveal in Explorer, then
   * `options.menuItems`).
   * - `options.state`: a session state name, or `{ icon, tone, text }` for a page with its own states.
   * - Metadata is `options.meta`, the model's `SessionMeta`, and the same on every page (see `sessionFacts`).
   * - `options.tabs` is `[{ key, label, onSelect }]`; the tab whose key is `options.current` is underlined and
   *   needs no `onSelect`.
   * - `options.sendAction(name)` runs a session action; it defaults to `page.send` of a `sessionAction` intent.
   */
  /**
   * The page tabs: a `nav` of `mg-tab` buttons, the current one marked with `aria-current`.
   * `tabs` is `[{ key, label, onSelect, disabled, title }]`; the current tab is not clickable.
   */
  function pageTabs(options) {
    const tabs = el('nav', null, 'mg-tabs');
    tabs.setAttribute('aria-label', options.label);
    for (const tab of options.tabs) {
      const node = el('button', tab.label, 'mg-tab');
      node.type = 'button';
      if (tab.title) node.title = tab.title;
      if (tab.key === options.current) node.setAttribute('aria-current', 'page');
      else if (tab.disabled) node.disabled = true;
      else node.addEventListener('click', tab.onSelect);
      tabs.append(node);
    }
    return tabs;
  }

  function sessionHeader(page, options) {
    const send = (name) => () => (options.sendAction ? options.sendAction(name) : page.send(sessionAction(name)));
    const header = el('header', null, 'mg-header mg-header--session');

    const identity = el('div', null, 'mg-header-row');
    identity.append(statusIndicator(options.state));
    if (options.workflowId) identity.append(el('span', options.workflowId, 'mg-workflow'));

    const title = el('h1', options.title, 'mg-title mg-title--clamp');
    title.title = options.title;

    const meta = el('p', null, 'mg-subtitle mg-meta');
    liveChips = [];
    for (const fact of sessionFacts(options.meta)) {
      const chip = el('span', null, 'mg-meta-item' + (fact.tone ? ' mg-status mg-status--' + fact.tone : ''));
      chip.title = fact.title;
      const text = el('span', fact.text);
      chip.append(icon(fact.icon), text);
      meta.append(chip);
      if (fact.live) liveChips.push({ node: text, text: fact.live });
    }
    if (liveChips.length > 0) keepFresh();

    const bar = el('div', null, 'mg-tabbar');
    const tabs = pageTabs({ label: copy.tabsLabel, tabs: options.tabs, current: options.current });
    const replyButton = el('button', copy.reply, 'mg-btn mg-btn--secondary mg-btn--sm mg-header-reply');
    replyButton.type = 'button';
    replyButton.addEventListener('click', send('reply'));
    bar.append(
      tabs,
      ...(options.meta && options.meta.canReply ? [replyButton] : []),
      menuButton({
        label: '⋯',
        ariaLabel: copy.menu.label,
        items: [
          { label: copy.menu.viewLog, onSelect: send('showLog') },
          { label: copy.menu.copySessionId, onSelect: send('copyId') },
          { label: copy.menu.revealInExplorer, onSelect: send('revealInExplorer') },
          ...(options.meta && options.meta.canComplete ? [{ label: copy.menu.completeSession, onSelect: send('completeSession') }] : []),
          ...(options.menuItems || []),
        ],
      }),
    );

    header.append(identity, title, meta, bar);
    return header;
  }

  // Tooltip. The native `title` tooltip does not reliably show in a webview, so an element that carries
  // `data-tip` gets one shared tooltip on hover and on keyboard focus. It is fixed to the viewport, so a card's
  // `overflow: clip` cannot cut it off. Text goes in with textContent.
  let tipNode = null;
  let tipAnchor = null;

  function tipOf(target) {
    return target && typeof target.closest === 'function' ? target.closest('[data-tip]') : null;
  }

  function hideTip() {
    tipAnchor = null;
    if (tipNode) tipNode.className = 'mg-tooltip';
  }

  function showTip(anchor) {
    if (anchor === tipAnchor) return;
    const text = anchor.getAttribute('data-tip');
    if (!text) {
      hideTip();
      return;
    }
    if (!tipNode) {
      tipNode = el('div', null, 'mg-tooltip');
      tipNode.setAttribute('role', 'tooltip');
      document.body.append(tipNode);
    }
    tipAnchor = anchor;
    tipNode.textContent = text;
    tipNode.className = 'mg-tooltip mg-tooltip--on';
    const rect = anchor.getBoundingClientRect();
    const width = tipNode.offsetWidth;
    const height = tipNode.offsetHeight;
    const viewport = document.documentElement.clientWidth || width;
    const gap = 6;
    const left = Math.max(gap, Math.min(rect.left + rect.width / 2 - width / 2, viewport - width - gap));
    const above = rect.top - height - gap;
    tipNode.style.left = left + 'px';
    tipNode.style.top = (above >= gap ? above : rect.bottom + gap) + 'px';
  }

  function installTooltips() {
    if (typeof document.addEventListener !== 'function') return;
    document.addEventListener('mouseover', (event) => {
      const anchor = tipOf(event.target);
      if (anchor) showTip(anchor);
      else hideTip();
    });
    document.addEventListener('focusin', (event) => {
      const anchor = tipOf(event.target);
      if (anchor) showTip(anchor);
    });
    document.addEventListener('focusout', hideTip);
    document.addEventListener('mousedown', hideTip);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideTip();
    });
    document.addEventListener('scroll', hideTip, true);
  }

  installTooltips();

  window.MigentPage = { el, section, connect, details, openAround, menuButton, trackFooter, pageTabs, sessionHeader, icon, statusIndicator, sessionStates: SESSION_STATES };
})();
