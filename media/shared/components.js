// Display components of the Migent UI kit: buttons, banners, chips, rows, sections, cards, the page header. Kit group
// (see docs/ui.md): a component takes data through its parameters, returns a node and reports interaction only
// through the callbacks the caller passes. It reads no model and talks to no host.
// Needs dom.js, copy.js and icons.js loaded first. Contributes to `window.MigentUi`. Every string is set with
// textContent.
//
// Calling convention: at most one positional parameter, the main content (a label or a title); everything else is
// one options object. Shared option names: `path`, `disabled`, `tone`, `kind`, `size`, `onClick`, `children`,
// `actions`, `tip` (the shared `data-tip` tooltip), `title` (the native `title` attribute), `role`.
// `tone` (`ok`, `warn`, `error`, `info`, `muted`) is presentation only. The announcement semantics are the separate
// `role` option (`alert`, `status` or `none`).
(function () {
  'use strict';

  const { el, icon } = window.MigentUi;
  const copy = window.MigentCopy;

  // ---------- buttons ----------

  /**
   * A button. `kind` is primary, secondary, quiet, link or danger; `size` is `'sm'` (compact, 24px) or `'md'`
   * (standard, 28px). A quiet or danger button is compact unless `size` says otherwise. `tip` is the shared tooltip; `title` the native one; `className` adds a class.
   */
  function button(label, options) {
    const settings = options || {};
    const compact = settings.size ? settings.size === 'sm' : settings.kind === 'quiet' || settings.kind === 'danger';
    const node = el(
      'button',
      label,
      'mg-btn' + (settings.kind ? ' mg-btn--' + settings.kind : '') + (compact ? ' mg-btn--sm' : ''),
    );
    node.type = 'button';
    node.disabled = settings.disabled === true;
    if (settings.tip) node.setAttribute('data-tip', settings.tip);
    if (settings.title) node.title = settings.title;
    if (settings.className) node.className += ' ' + settings.className;
    node.addEventListener('click', settings.onClick || (() => undefined));
    return node;
  }

  /** A compact link-style action with a plus icon that adds an item to a list. `options`: `onClick`, `disabled`. */
  function addButton(label, options) {
    const node = button('', options);
    node.classList.add('mg-add');
    node.append(icon('add'), label);
    return node;
  }

  /**
   * The add action of a whole section list: a wide button with a dashed outline and a plus icon, placed at the
   * bottom of the list so it is a big target right where the new item appears. `options`: `onClick`, `disabled` and
   * `empty`, the message to show when the list is empty: the block then becomes one dashed frame that holds the
   * message and, under it, the same button without an outline of its own.
   */
  function addBlockButton(label, options) {
    const settings = options || {};
    const node = button('', settings);
    node.classList.add('mg-add-block');
    node.append(icon('add'), label);
    return settings.empty ? empty(settings.empty, { action: node }) : node;
  }

  /**
   * A quiet icon-only action (move up, move down). `label` is its accessible name and tooltip (`data-tip`); the
   * button shows no text. `options`: `icon` (the codicon id), `onClick`, `disabled`, `path` (a `data-path`, so a
   * repaint can put the focus back on it).
   */
  function iconButton(label, options) {
    const settings = options || {};
    const node = button('', { kind: 'quiet', onClick: settings.onClick, disabled: settings.disabled });
    if (settings.path) node.dataset.path = settings.path;
    node.classList.add('mg-btn--icon');
    node.append(icon(settings.icon));
    node.setAttribute('aria-label', label);
    node.setAttribute('data-tip', label);
    return node;
  }

  /**
   * A destructive row action drawn as a trash icon. `label` is its accessible name and tooltip (`data-tip`), so
   * name the row it removes ("Remove decision 2"); the button shows no text. `options`: `onClick`, `disabled`.
   */
  function removeButton(label, options) {
    const settings = options || {};
    const node = button('', { kind: 'danger', onClick: settings.onClick, disabled: settings.disabled });
    node.classList.add('mg-btn--icon');
    node.append(icon('trash'));
    node.setAttribute('aria-label', label);
    node.setAttribute('data-tip', label);
    return node;
  }

  // ---------- messages ----------

  /**
   * One line of a notice: a `mg-alert` in a `tone` (`error` or `warn`). `role` is `alert`, `status` or `none`
   * (the default: no `role`).
   */
  function alertLine(message, options) {
    const settings = options || {};
    const node = el('p', message, 'mg-alert mg-' + (settings.tone || 'error'));
    if (settings.role === 'alert' || settings.role === 'status') node.setAttribute('role', settings.role);
    return node;
  }

  /**
   * The one banner: an icon and a left edge in the tone of the message. `options`: `tone` (`ok`, `info`, `warn` or
   * `error`), `icon` (defaults by tone), `lines` (the first is the message, the rest are quieter; a line is a string
   * or `{ text, className }`), `children` (nodes under the lines), `actions` (nodes under those) and `role`
   * (`alert`, `status` or `none`; the default follows the tone: `alert` for an error, `status` otherwise).
   */
  function banner(options) {
    const tone = options.tone || 'info';
    const node = el('div', null, 'mg-banner mg-banner--' + tone);
    const role = options.role || (tone === 'error' ? 'alert' : 'status');
    if (role !== 'none') node.setAttribute('role', role);
    const defaults = { ok: 'pass', info: 'info', warn: 'warning', error: 'error' };
    const mark = el('span', null, 'mg-banner__icon');
    mark.append(icon(options.icon || defaults[tone] || 'info'));
    const body = el('div');
    (options.lines || []).forEach((line, index) => {
      const spec = typeof line === 'string' ? { text: line } : line;
      body.append(el('p', spec.text, spec.className || (index === 0 ? '' : 'mg-muted')));
    });
    for (const child of options.children || []) body.append(child);
    for (const action of options.actions || []) body.append(action);
    node.append(mark, body);
    return node;
  }

  /**
   * A banner with a summary and an issue list. `options.issues` is a list of issues and `options.resolve(issue)`,
   * given by the page, returns `{ text, activate }` (a link that calls `activate`) or `{ text }` (plain text). The
   * kit reads no DOM and knows no path, so what an issue points at stays the page's decision.
   */
  function issueBanner(options) {
    const items = el('ul', null, 'mg-list mg-issue-list');
    for (const issue of options.issues) {
      const target = options.resolve(issue);
      const item = el('li');
      if (typeof target.activate === 'function') {
        item.append(button(target.text, { kind: 'link', size: 'md', onClick: target.activate }));
      } else {
        item.append(el('span', target.text));
      }
      items.append(item);
    }
    return banner({ tone: options.tone, lines: [options.summary], children: [items] });
  }

  /** The area under the page header that holds banners and issue lists. */
  function notices(children) {
    const node = el('div', null, 'mg-notices');
    node.append(...children);
    return node;
  }

  /** A short, quiet value such as a role or a count. `options`: `tone` (`info`, `warn` or `error`). */
  function chip(label, options) {
    const tone = options && options.tone;
    return el('span', label, 'mg-chip' + (tone ? ' mg-chip--' + tone : ''));
  }

  /** A badge-colored label, such as a state or an artifact name. */
  function pill(label) {
    return el('span', label, 'mg-pill');
  }

  /**
   * A block that states what is missing instead of leaving a blank area. With `options.action` (a node) it is one
   * dashed frame that holds the message and, under it, the action.
   */
  function empty(message, options) {
    const action = options && options.action;
    if (!action) return el('p', message, 'mg-empty');
    const frame = el('div', null, 'mg-empty');
    frame.append(el('p', message, 'mg-empty-text'), action);
    return frame;
  }

  /**
   * The status badge: an icon and a text, tinted by `tone`. `state` is `{ icon, tone, text, spin? }`. The text is
   * always shown too, so color is never the only signal.
   */
  function statusIndicator(state) {
    const node = el('span', null, 'mg-status mg-status--' + state.tone);
    node.append(icon(state.icon, state.spin), el('span', state.text));
    return node;
  }

  // ---------- lists ----------

  /**
   * One row of a `mg-list` (the `li` to append to a `ul.mg-list`): `main` on the left and `meta` on the right, each a
   * string or a list of nodes. With `onClick` the row is a button. `options`: `main`, `meta`, `onClick`, `title`
   * (native tooltip of the row), `mainClass`, `metaClass`.
   */
  function listRow(options) {
    const row = el(options.onClick ? 'button' : 'div', null, 'mg-row');
    if (options.onClick) {
      row.type = 'button';
      row.addEventListener('click', options.onClick);
    }
    if (options.title) row.title = options.title;
    const part = (content, className) => {
      const node = el('span', typeof content === 'string' ? content : null, className);
      if (Array.isArray(content)) node.append(...content);
      return node;
    };
    row.append(
      part(options.main, 'mg-row-main' + (options.mainClass ? ' ' + options.mainClass : '')),
      part(options.meta, 'mg-row-meta' + (options.metaClass ? ' ' + options.metaClass : '')),
    );
    const item = el('li');
    item.append(row);
    return item;
  }

  // ---------- collapsibles and menus ----------

  // Open/closed state of <details>, kept in memory so a model re-render does not collapse them.
  const detailsOpen = new Map();

  /**
   * A collapsible block (<details>/<summary>) that stays as the user left it across re-renders.
   * The shared chevron has a box of its own, so a header with chips or a wrapped title keeps the arrow on the
   * first line. `summary` is a string, or a node when the header needs a badge and metadata chips.
   * `options`: `key` (keeps the open state across repaints), `className`, `open` (starts open unless the reader
   * has toggled it) and `path` (a `data-path` on the summary, so a repaint can focus the header without opening
   * the block).
   */
  function details(summary, options) {
    const settings = options || {};
    const node = el('details', null, 'mg-details' + (settings.className ? ' ' + settings.className : ''));
    node.open = detailsOpen.has(settings.key) ? detailsOpen.get(settings.key) === true : settings.open === true;
    const head = el('summary', null, 'mg-details-summary');
    if (settings.path) head.dataset.path = settings.path;
    const arrow = el('span', null, 'mg-details-arrow');
    arrow.append(icon('chevron-down'));
    head.append(arrow);
    const heading = el('div', null, 'mg-details-heading');
    if (typeof summary === 'string') heading.textContent = summary;
    else if (summary) heading.append(summary);
    head.append(heading);
    node.append(head);
    node.addEventListener('toggle', () => detailsOpen.set(settings.key, node.open));
    return node;
  }

  /**
   * A collapsible card on top of `details`: a header with a number badge, a title, one quiet summary line and
   * warning chips, then the body.
   * `options`: `key` (keeps it open or closed across repaints), `number`, `title`, `summary` (strings joined into
   * one line of muted text beside the title, cut with an ellipsis when it does not fit, the whole header's tooltip
   * carrying it in full), `alerts` (warning chips, the only framed items in the header),
   * `warn` (warning badge), `open` (default state), `path` (a `data-path` on the header, so a repaint can focus it
   * without opening the card), `tools` (icon buttons at the right of the header, such as move and remove), `body`
   * (nodes), `describe` (a function returning the current `title`, `summary`, `alerts` and `warn`; the card's
   * `refresh()` calls it and redraws the header, so a value edited in the body shows in the header at once without
   * rebuilding the card). The caller may set `id` on the result.
   */
  function collapsibleCard(options) {
    const head = el('div', null, 'mg-collapsible-head');
    let tools = null;
    if (options.tools && options.tools.length > 0) {
      tools = el('span', null, 'mg-collapsible-tools');
      tools.append(...options.tools);
    }
    // The badge and the title cell are redrawn by `refresh`; the tools are the same nodes throughout, so a button
    // that holds the focus keeps it.
    const fill = (state) => {
      const badge = el('span', String(options.number), 'mg-badge' + (state.warn ? ' mg-badge--warn' : ''));
      // One line: the title, its warning chips, then the quiet summary, level with the badge and the tools. The
      // title is never cut; the summary is what gives way, and the tooltip of the cell carries it whole.
      const main = el('span', null, 'mg-collapsible-main');
      main.append(el('span', state.title, 'mg-collapsible-title'));
      const alerts = el('span', null, 'mg-collapsible-alerts');
      alerts.append(...(state.alerts || []));
      if (alerts.children.length > 0) main.append(alerts);
      const parts = (state.summary || []).filter((part) => part !== '');
      if (parts.length > 0) {
        const text = parts.join(' · ');
        main.append(el('span', text, 'mg-collapsible-summary'));
        main.setAttribute('data-tip', state.title ? state.title + ' — ' + text : text);
      }
      head.replaceChildren(badge, main, ...(tools === null ? [] : [tools]));
    };
    fill(options);
    const node = details(head, { key: options.key, className: 'mg-collapsible', open: options.open, path: options.path });
    const body = el('div', null, 'mg-collapsible-body');
    body.append(...(options.body || []));
    node.append(body);
    node.refresh = () => {
      if (typeof options.describe === 'function') fill({ ...options, ...options.describe() });
    };
    return node;
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

  // ---------- page header ----------

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

  // Header chips that follow the clock: [{ node, text() }], refreshed twice a minute while the page is open.
  const REFRESH_MS = 30 * 1000;
  let liveChips = [];
  let refreshTimer = null;

  function refreshLiveChips() {
    for (const chipNode of liveChips) chipNode.node.textContent = chipNode.text();
  }

  function keepFresh() {
    if (refreshTimer === null && typeof setInterval === 'function') refreshTimer = setInterval(refreshLiveChips, REFRESH_MS);
  }

  /**
   * The header every page shares, in four tiers: the identity row, the title, the facts and one row with the page
   * tabs, the page's own actions and the more menu.
   * - `options.state`: `{ icon, tone, text }` for the status badge; or `options.eyebrow`, a plain label for a page
   *   that has no state. `options.label` is an optional secondary label (the workflow id).
   * - `options.title`; `options.clamp` limits it to two lines and puts the full text in its tooltip.
   * - `options.facts`: `[{ icon, text, title?, tone?, live? }]`; `live` re-computes the text twice a minute.
   * - `options.tabs`: `{ label, tabs, current }` as for `pageTabs`. `options.actions`: nodes between tabs and menu.
   * - `options.menu`: `{ label, items }` for the more menu.
   */
  function pageHeader(options) {
    const header = el('header', null, 'mg-header mg-header--session');

    const identity = el('div', null, 'mg-header-row');
    if (options.state) identity.append(statusIndicator(options.state));
    else if (options.eyebrow) identity.append(el('span', options.eyebrow, 'mg-eyebrow'));
    if (options.label) identity.append(el('span', options.label, 'mg-workflow'));

    const title = el('h1', options.title, 'mg-title' + (options.clamp ? ' mg-title--clamp' : ''));
    if (options.clamp) title.title = options.title;

    const meta = el('p', null, 'mg-subtitle mg-meta');
    liveChips = [];
    for (const fact of options.facts || []) {
      const factNode = el('span', null, 'mg-meta-item' + (fact.tone ? ' mg-status mg-status--' + fact.tone : ''));
      if (fact.title) factNode.title = fact.title;
      const text = el('span', fact.text);
      factNode.append(icon(fact.icon), text);
      meta.append(factNode);
      if (fact.live) liveChips.push({ node: text, text: fact.live });
    }
    if (liveChips.length > 0) keepFresh();

    const bar = el('div', null, 'mg-tabbar');
    bar.append(pageTabs(options.tabs), ...(options.actions || []));
    if (options.menu) bar.append(menuButton({ label: copy.kit.menuTrigger, ariaLabel: options.menu.label, items: options.menu.items }));

    header.append(identity, title, meta, bar);
    return header;
  }

  // ---------- sections ----------

  /** A section heading: title, an optional count chip, a note and trailing actions. */
  function sectionHead(title, options) {
    const settings = options || {};
    const head = el('div', null, 'mg-section-head');
    const body = el('div', null, 'mg-section-heading');
    const row = el('div', null, 'mg-section-title-row');
    row.append(el(settings.level === 3 ? 'h3' : 'h2', title, 'mg-section-title'));
    if (settings.count) row.append(chip(settings.count));
    body.append(row);
    if (settings.note) body.append(el('p', settings.note, 'mg-section-note'));
    head.append(body);
    const actions = el('div', null, 'mg-section-actions');
    for (const action of settings.actions || []) actions.append(action);
    head.append(actions);
    return head;
  }

  /**
   * A section: one head band that titles it, then one body that holds the content. `options.level` picks the
   * heading level (2 for a page section, 3 for a block inside one). `options.variant` selects the surface:
   * `group` sits inline on the page and `card` is a bordered item such as an output or a decision route.
   * `options.surface` puts a page section's body on a card, for a section whose content has no items of its own.
   * Also `count`, `note`, `actions`, `accent` and `children`.
   */
  function section(title, options) {
    const settings = options || {};
    let className = 'mg-section';
    if (settings.variant) className += ' mg-section--' + settings.variant;
    if (settings.accent) className += ' mg-section--accent';
    if (settings.surface) className += ' mg-section--surface';
    const node = el('section', null, className);
    node.append(sectionHead(title, settings));
    const body = el('div', null, 'mg-section-body');
    for (const child of settings.children || []) body.append(child);
    node.append(body);
    return node;
  }

  /**
   * A named block inside a section: the same head and body as a page section, sized down. `options`: `note`,
   * `actions`, `accent`, `children`, and `card`, which renders it as a bordered item instead, for a repeated
   * output, suggestion or decision route.
   */
  function group(title, options) {
    const settings = options || {};
    return section(title, {
      level: 3,
      note: settings.note,
      variant: settings.card ? 'card' : 'group',
      accent: settings.accent,
      actions: settings.actions,
      children: settings.children,
    });
  }

  // ---------- footers ----------

  /**
   * A sticky action footer (`mg-footer`): one row whose items are vertically centred and whose buttons sit on the
   * right. `options`: `children` (nodes) and `className` (an extra class). Pass `into` (an earlier footer) to
   * replace its children in place.
   */
  function footer(options) {
    const settings = options || {};
    const node = settings.into || el('footer', null, 'mg-footer' + (settings.className ? ' ' + settings.className : ''));
    if (settings.children) node.replaceChildren(...settings.children);
    return node;
  }

  /**
   * The sticky save footer: the save state on the left, Discard and Save on the right. Pass `into` (an earlier
   * result) to refill it in place. `options`: `stateLabel` (empty shows nothing), `saving`, `busy`, `canDiscard`,
   * `canSave`, `onDiscard`, `onSave`, optional `saveLabel` and `discardLabel`. Save and Discard are disabled while
   * `saving` (the Save label then reads the saving text) or `busy` (disabled, label unchanged).
   */
  function saveFooter(options) {
    const node = footer({ into: options.into, className: 'mg-save-footer' });
    // A refill keeps the same nodes. A field's `change` event fires when Save takes the focus, in the middle of the
    // press; replacing the button then would drop the click, since it needs the press and the release on one node.
    if (!node.mgParts) {
      const state = el('span', null, 'mg-save-state');
      const actions = el('div', null, 'mg-footer-actions');
      const parts = { state, handlers: {} };
      parts.discard = button(copy.kit.discard, { kind: 'secondary', onClick: (event) => parts.handlers.onDiscard(event) });
      parts.save = button(copy.kit.save, { kind: 'primary', onClick: (event) => parts.handlers.onSave(event) });
      actions.append(parts.discard, parts.save);
      node.replaceChildren(state, actions);
      node.mgParts = parts;
    }
    const parts = node.mgParts;
    parts.handlers.onDiscard = options.onDiscard || (() => undefined);
    parts.handlers.onSave = options.onSave || (() => undefined);
    parts.state.replaceChildren();
    if (options.stateLabel) parts.state.append(icon('circle'), options.stateLabel);
    const locked = options.saving === true || options.busy === true;
    parts.discard.disabled = locked || options.canDiscard !== true;
    parts.discard.textContent = options.discardLabel || copy.kit.discard;
    parts.save.disabled = locked || options.canSave !== true;
    parts.save.textContent = options.saving ? copy.kit.saving : options.saveLabel || copy.kit.save;
    return node;
  }

  window.MigentUi = Object.assign(window.MigentUi || {}, {
    button,
    addButton,
    addBlockButton,
    iconButton,
    removeButton,
    alertLine,
    banner,
    issueBanner,
    notices,
    chip,
    pill,
    empty,
    statusIndicator,
    listRow,
    details,
    collapsibleCard,
    menuButton,
    pageTabs,
    pageHeader,
    section,
    group,
    footer,
    saveFooter,
  });
})();
