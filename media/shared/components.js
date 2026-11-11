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
   * dashed frame that holds the message and, under it, the action; `options.icon` puts a codicon above the message.
   */
  function empty(message, options) {
    const settings = options || {};
    const action = settings.action;
    if (!action && !settings.icon) return el('p', message, 'mg-empty');
    const frame = el('div', null, 'mg-empty');
    if (settings.icon) {
      const mark = el('span', null, 'mg-empty-icon');
      mark.append(icon(settings.icon));
      frame.append(mark);
    }
    frame.append(el('p', message, 'mg-empty-text'));
    if (action) frame.append(action);
    return frame;
  }

  /**
   * The status badge: an icon and a text, tinted by `tone`. `state` is `{ icon, tone, text, spin?, compact? }`. The
   * text is always rendered too, so color is never the only signal; `compact` hides it visually but keeps it for
   * assistive technology and puts it in the tooltip.
   */
  function statusIndicator(state) {
    const node = el('span', null, 'mg-status mg-status--' + state.tone);
    node.append(icon(state.icon, state.spin));
    if (state.compact) {
      node.classList.add('mg-status--compact');
      node.setAttribute('data-tip', state.text);
      node.append(el('span', state.text, 'mg-visually-hidden'));
    } else {
      node.append(el('span', state.text));
    }
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

  /**
   * A dense list (`ul.mg-list`): the tabular rows a page appends one per line, separated by the kit's divider.
   * `items` are nodes (usually `listRow` results), strings or `{ text, className }` specs.
   */
  function denseList(items) {
    const node = el('ul', null, 'mg-list');
    for (const item of items || []) {
      if (typeof item === 'string') node.append(el('li', item));
      else if (isNode(item)) node.append(item);
      else if (item) node.append(el('li', item.text, item.className));
    }
    return node;
  }

  /**
   * A plain list of lines without dividers: activity, commands, inherited options. `items` are strings or nodes;
   * `options.mono` puts the string lines in the mono font.
   */
  function plainList(items, options) {
    const settings = options || {};
    const node = el('ul', null, 'mg-list--plain');
    for (const item of items || []) {
      const line = el('li');
      if (typeof item === 'string') {
        line.textContent = item;
        if (settings.mono) line.classList.add('mg-mono');
      } else if (item) {
        line.append(item);
      }
      node.append(line);
    }
    return node;
  }

  /**
   * A stack of blocks with one rhythm between them: `gap` is `'card'` (the gap between item cards) or `'block'`
   * (the gap between blocks in a body). `children` are the nodes to stack.
   */
  function stack(children, options) {
    const gap = options && options.gap === 'card' ? 'card' : 'block';
    const node = el('div', null, gap === 'card' ? 'mg-card-stack' : 'mg-block-stack');
    node.append(...(children || []));
    return node;
  }

  /** A row of actions: one flex line whose items are buttons or other controls. */
  function actions(children) {
    const node = el('div', null, 'mg-actions');
    node.append(...(children || []));
    return node;
  }

  // ---------- values ----------

  /**
   * A reference value: an id, a hash or a path. Display only: mono, cut at the end (`id`, `hash`) or wrapped
   * (`path`) by CSS, with the full value in the DOM and in the tooltip. The copy action is a separate tool
   * (`refValue.copyButton`), never part of this node, so it can sit outside a link button.
   */
  function refValue(value, options) {
    const kind = options && options.kind;
    const node = el('span', String(value), 'mg-ref' + (kind ? ' mg-ref--' + kind : ''));
    node.dataset.tip = String(value);
    return node;
  }

  /** The copy tool of a reference value: an icon button named by `label` (accessible name and tooltip). */
  refValue.copyButton = function copyButton(label, onCopy) {
    return iconButton(label, { icon: 'copy', onClick: onCopy });
  };

  /**
   * A key-value grid (`dl.mg-kv`): each pair is a quiet label and its value, with an optional tool at the end of
   * the row. `pairs` is `[{ label, value, tone?, mono?, tools? }]`; `value` is a string or a node, and `tools` a
   * list of nodes. `options.dense` tightens the column gap.
   */
  function keyValues(pairs, options) {
    const settings = options || {};
    const list = el('dl', null, 'mg-kv' + (settings.dense ? ' mg-kv--dense' : ''));
    for (const pair of pairs || []) {
      list.append(el('dt', pair.label));
      const cell = el('dd');
      const value = el('div', null, 'mg-kv-value');
      if (typeof pair.value === 'string') value.textContent = pair.value;
      else if (pair.value) value.append(pair.value);
      if (pair.mono) value.classList.add('mg-mono');
      const tone = toneClass(pair.tone);
      if (tone) value.classList.add(tone);
      cell.append(value);
      if (pair.tools && pair.tools.length > 0) {
        const tools = el('span', null, 'mg-kv-tools');
        tools.append(...pair.tools);
        cell.append(tools);
      }
      list.append(cell);
    }
    return list;
  }

  // ---------- collapsibles and menus ----------

  // Open/closed state of <details>, kept in memory so a model re-render does not collapse them.
  const detailsOpen = new Map();

  /**
   * A collapsible block (<details>/<summary>) that stays as the user left it across re-renders.
   * The shared chevron has a box of its own, so a header with chips or a wrapped title keeps the arrow on the
   * first line. `summary` is a string, or a node when the header needs a badge and metadata chips.
   * `options`: `key` (keeps the open state across repaints), `className`, `open` (starts open unless the reader
   * has toggled it), `path` (a `data-path` on the summary, so a repaint can focus the header without opening
   * the block), `facts` (strings shown as a quiet summary beside a string title) and `ruled` (a top rule and the
   * block gap above it).
   */
  function details(summary, options) {
    const settings = options || {};
    const className = ['mg-details', settings.ruled ? 'mg-details--ruled' : '', settings.className || '']
      .filter(Boolean)
      .join(' ');
    const node = el('details', null, className);
    node.open = detailsOpen.has(settings.key) ? detailsOpen.get(settings.key) === true : settings.open === true;
    const head = el('summary', null, 'mg-details-summary');
    if (settings.path) head.dataset.path = settings.path;
    const arrow = el('span', null, 'mg-details-arrow');
    arrow.append(icon('chevron-down'));
    head.append(arrow);
    const heading = el('div', null, 'mg-details-heading');
    if (typeof summary === 'string') heading.textContent = summary;
    else if (summary) heading.append(summary);
    const facts = (settings.facts || []).filter((fact) => fact !== '');
    if (facts.length > 0) heading.append(el('span', facts.join(', '), 'mg-summary'));
    head.append(heading);
    node.append(head);
    node.addEventListener('toggle', () => detailsOpen.set(settings.key, node.open));
    return node;
  }

  // ---------- item cards ----------

  const TITLE_LINES = { 1: ' mg-item-title--clamp-1', 2: ' mg-item-title--clamp-2', 3: ' mg-item-title--clamp-3' };

  function titleClass(base, lines) {
    return base + (TITLE_LINES[lines] || '');
  }

  function isNode(value) {
    return Boolean(value) && typeof value.tagName === 'string';
  }

  function toneClass(tone) {
    if (!tone) return '';
    if (tone === 'muted' || tone === 'warn' || tone === 'error') return 'mg-' + tone;
    return 'mg-status--' + tone;
  }

  function leadingNode(name) {
    const node = el('span', null, 'mg-item-leading');
    node.append(icon(name));
    return node;
  }

  /** The plain text of a list of metadata segments, for the tooltip and the accessible name. */
  function metaText(segments) {
    return segments
      .map((segment) => {
        if (typeof segment === 'string') return segment;
        if (isNode(segment)) return segment.textContent;
        return segment && typeof segment.text === 'string' ? segment.text : '';
      })
      .filter((part) => part !== '')
      .join(' · ');
  }

  /** The rich metadata line: strings and kit nodes separated by the same middle dot as a plain summary. */
  function metaLine(segments) {
    const line = el('span', null, 'mg-item-meta');
    segments.forEach((segment, index) => {
      if (index > 0) line.append(' · ');
      if (typeof segment === 'string') {
        line.append(el('span', segment));
      } else if (isNode(segment)) {
        line.append(segment);
      } else if (segment) {
        const value = el('span', segment.text || '');
        if (segment.mono) value.classList.add('mg-mono');
        const tone = toneClass(segment.tone);
        if (tone) value.classList.add(tone);
        line.append(value);
      }
    });
    return line;
  }

  /** The plain text of a card: its title and metadata, in the same shape as the visible head. */
  function descriptorText(settings, segments, parts) {
    const detail = segments.length > 0 ? metaText(segments) : parts.join(' · ');
    if (settings.title && detail) return settings.title + ' — ' + detail;
    return settings.title || detail;
  }

  /** The head tooltip: an explicit `tip` wins, so a card can show a value the reader cannot see. */
  function headTip(settings, segments, parts) {
    return settings.tip || descriptorText(settings, segments, parts);
  }

  /** The accessible name of a link card: always the title and metadata, never the tooltip override. */
  function accessibleName(settings, segments, parts) {
    return descriptorText(settings, segments, parts) || settings.tip || '';
  }

  function endSlot(status, tools) {
    if (!status && !tools) return null;
    const end = el('span', null, 'mg-item-end');
    if (status) end.append(status);
    if (tools) end.append(tools);
    return end;
  }

  function itemMain(settings, segments, parts, titleLines) {
    const main = el('span', null, 'mg-item-main');
    main.append(el('span', settings.title, titleClass('mg-item-title', titleLines)));
    const alerts = el('span', null, 'mg-item-alerts');
    alerts.append(...(settings.alerts || []));
    if (alerts.children.length > 0) main.append(alerts);
    if (segments.length > 0) main.append(metaLine(segments));
    else if (parts.length > 0) main.append(el('span', parts.join(' · '), 'mg-item-summary'));
    return main;
  }

  function collapsibleItem(settings, segments, parts, titleLines, tone) {
    const tools = settings.tools && settings.tools.length > 0 ? el('span', null, 'mg-collapsible-tools') : null;
    if (tools) tools.append(...settings.tools);
    const head = el('div', null, 'mg-collapsible-head');
    // The badge and the main region are redrawn by `refresh`; the tools are the same nodes throughout, so a button
    // that holds the focus keeps it.
    const fill = (state) => {
      const lines = TITLE_LINES[state.titleLines] ? state.titleLines : titleLines;
      const rich = Array.isArray(state.meta) ? state.meta : segments;
      const summary = (state.summary || []).filter((part) => part !== '');
      const leadNode = state.number !== undefined
        ? el('span', String(state.number), 'mg-badge' + (state.warn ? ' mg-badge--warn' : ''))
        : state.leading ? leadingNode(state.leading) : null;
      const main = el('span', null, 'mg-collapsible-main');
      main.append(el('span', state.title, titleClass('mg-collapsible-title', lines)));
      const alerts = el('span', null, 'mg-collapsible-alerts');
      alerts.append(...(state.alerts || []));
      if (alerts.children.length > 0) main.append(alerts);
      if (rich.length > 0) main.append(metaLine(rich));
      else if (summary.length > 0) main.append(el('span', summary.join(' · '), 'mg-collapsible-summary'));
      if (state.tip || rich.length > 0 || summary.length > 0) main.setAttribute('data-tip', headTip(state, rich, summary));
      const status = state.status ? statusIndicator(state.status) : null;
      const children = [];
      if (leadNode) children.push(leadNode);
      children.push(main);
      if (status) {
        const end = el('span', null, 'mg-item-end');
        end.append(status);
        if (tools) end.append(tools);
        children.push(end);
      } else if (tools) {
        children.push(tools);
      }
      head.className = 'mg-collapsible-head' + (leadNode ? '' : ' mg-collapsible-head--no-lead');
      head.replaceChildren(...children);
    };
    fill(settings);
    const node = details(head, {
      key: settings.key,
      className: 'mg-collapsible' + tone,
      open: settings.open,
      path: settings.path,
    });
    const body = el('div', null, 'mg-collapsible-body');
    body.append(...(settings.body || []));
    node.append(body);
    node.refresh = () => {
      if (typeof settings.describe === 'function') fill({ ...settings, ...settings.describe() });
    };
    return node;
  }

  /**
   * One bordered item card, with three modes decided by the options: collapsible when `body` is given (a `<details>`
   * head that keeps its open state by `key`), link when `onClick` is given (one `<button>` holding the lead and the
   * main region; `status` and `tools` stay outside it), and static otherwise.
   * `options`: `title`, `titleLines` (1-3 clamps the title by CSS; the full text stays in the DOM and the tooltip),
   * `number` (index badge) or `leading` (a codicon before the title), `summary` (plain strings joined by ` · `),
   * `meta` (rich segments: strings, `{ text, mono?, tone? }` or kit nodes; replaces `summary`), `status`
   * (`{ icon, tone, text, spin?, compact? }` in the end slot), `alerts` (warning chips), `tools` (icon buttons in
   * the end slot), `tone` (`info`, `warn` or `error` edge), `affordance` (the link mode's trailing icon, default
   * `chevron-right`), `tip`, `key`, `path`, `open`, `describe`/`refresh` (collapsible header redraw).
   */
  function itemCard(options) {
    const settings = options || {};
    const segments = Array.isArray(settings.meta) ? settings.meta : [];
    const parts = (settings.summary || []).filter((part) => part !== '');
    const titleLines = TITLE_LINES[settings.titleLines] ? settings.titleLines : null;
    const tone = settings.tone ? ' mg-item--' + settings.tone : '';
    if (Array.isArray(settings.body)) return collapsibleItem(settings, segments, parts, titleLines, tone);

    const lead = settings.number !== undefined
      ? el('span', String(settings.number), 'mg-badge' + (settings.warn ? ' mg-badge--warn' : ''))
      : settings.leading ? leadingNode(settings.leading) : null;
    const main = itemMain(settings, segments, parts, titleLines);
    const status = settings.status ? statusIndicator(settings.status) : null;
    const tools = settings.tools && settings.tools.length > 0 ? el('span', null, 'mg-item-tools') : null;
    if (tools) tools.append(...settings.tools);
    const tip = headTip(settings, segments, parts);
    const name = accessibleName(settings, segments, parts);
    const link = typeof settings.onClick === 'function';
    const head = el('div', null, 'mg-item-head' + (link ? '' : lead ? ' mg-item-head--lead' : ''));
    if (settings.path) head.dataset.path = settings.path;
    if (link) {
      const button = el('button', null, 'mg-item-link' + (lead ? '' : ' mg-item-link--no-lead'));
      button.type = 'button';
      if (lead) button.append(lead);
      button.append(main);
      const afford = el('span', null, 'mg-item-afford');
      afford.append(icon(settings.affordance || 'chevron-right'));
      button.append(afford);
      if (name) button.setAttribute('aria-label', name);
      if (tip) button.setAttribute('data-tip', tip);
      button.addEventListener('click', settings.onClick);
      head.append(button);
    } else {
      if (lead) head.append(lead);
      head.append(main);
      if (tip) head.setAttribute('data-tip', tip);
    }
    const end = endSlot(status, tools);
    if (end) head.append(end);
    const node = el('div', null, 'mg-item mg-item--' + (link ? 'link' : 'static') + tone);
    node.append(head);
    return node;
  }

  /**
   * A collapsible card on top of `itemCard`'s collapsible mode. It never passes `titleLines` or `meta`, so the title
   * stays uncut and the summary stays the plain joined string; the `mg-collapsible*` head and class names are kept
   * for the pages and tests that already depend on them.
   * `options`: `key`, `number`, `title`, `summary`, `alerts`, `warn`, `open`, `path`, `tools`, `body`, `describe`.
   */
  function collapsibleCard(options) {
    const settings = { ...(options || {}) };
    delete settings.titleLines;
    delete settings.meta;
    return itemCard({ ...settings, body: settings.body || [] });
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
    if (settings.accent === 'warn') className += ' mg-section--accent-warn';
    else if (settings.accent === 'error') className += ' mg-section--accent-error';
    else if (settings.accent) className += ' mg-section--accent';
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
    denseList,
    plainList,
    stack,
    actions,
    refValue,
    keyValues,
    details,
    itemCard,
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
