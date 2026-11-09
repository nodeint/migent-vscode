// Shared form kit for Migent webview pages. Loaded after page.js (see docs/ui.md).
// It builds controls and layout only: the page owns the data, validation and repaint. Every string is set with
// textContent. Exposes `window.MigentForm`.
(function () {
  'use strict';

  const { el } = window.MigentPage;

  function controlId(path) {
    return 'mg-' + String(path || 'control').replaceAll(/[^a-z0-9_-]+/gi, '-');
  }

  function currentValue(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function applyCommon(node, options) {
    if (options.path) node.dataset.path = options.path;
    node.disabled = options.disabled === true;
    if (options.placeholder) node.placeholder = options.placeholder;
    return node;
  }

  function listen(node, handler) {
    if (typeof handler === 'function') node.addEventListener('input', handler);
  }

  // ---------- controls ----------

  /** A single-line text input. `options.list` names a datalist. */
  function text(options) {
    const input = el('input', null, 'mg-input');
    input.type = options.type || 'text';
    input.value = currentValue(options.value);
    applyCommon(input, options);
    if (options.list) input.setAttribute('list', options.list);
    listen(input, () => options.onInput(input.value));
    return input;
  }

  /** A whole-number input; an empty field reports `null` instead of 0. */
  function number(options) {
    const input = el('input', null, 'mg-input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = currentValue(options.value);
    applyCommon(input, options);
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      options.onInput(raw === '' ? null : Number(raw));
    });
    return input;
  }

  /** A multi-line text input. */
  function textarea(options) {
    const area = el('textarea', null, 'mg-input mg-textarea');
    area.rows = options.rows || 3;
    area.value = currentValue(options.value);
    applyCommon(area, options);
    listen(area, () => options.onInput(area.value));
    return area;
  }

  /**
   * A select over `options.options` (`[{ value, label }]`). A value the list does not know stays visible, so an
   * imported file is never silently rewritten.
   */
  function select(options) {
    const current = currentValue(options.value);
    const choices = Array.isArray(options.options) ? options.options : [];
    const list = choices.some((choice) => choice.value === current)
      ? choices
      : [{ value: current, label: current === '' ? '(none)' : current + ' (not in list)' }, ...choices];
    const node = el('select', null, 'mg-select');
    applyCommon(node, options);
    for (const choice of list) {
      const option = el('option', choice.label);
      option.value = choice.value;
      if (choice.value === current) option.selected = true;
      node.append(option);
    }
    node.addEventListener('change', () => options.onInput(node.value));
    return node;
  }

  /**
   * A control that looks like a select and asks the page to open its own picker (`options.onPick`). The kit only
   * shows the current value; the page owns the choice and repaints afterwards.
   */
  function picker(options) {
    const value = currentValue(options.value);
    const node = el('button', null, 'mg-input mg-picker');
    node.type = 'button';
    if (options.path) node.dataset.path = options.path;
    node.disabled = options.disabled === true;
    const label = el('span', value === '' ? options.placeholder || '' : value, 'mg-picker-value');
    if (value === '') label.classList.add('mg-picker-value--empty');
    node.append(label, window.MigentPage.icon('chevron-down'));
    node.addEventListener('click', () => options.onPick());
    return node;
  }

  /**
   * The root of a form. One delegated `input` and `change` listener reports every value edit inside it through
   * `options.onEdit`, so a control never has to remember to. The control's own listener runs first (it is deeper),
   * so the draft already holds the new value when `onEdit` runs. Add, remove and pick actions are clicks, not
   * value edits, and still call `onEdit` themselves. The node lays out as its children (`display: contents`).
   */
  function root(children, options) {
    const node = el('div', null, 'mg-form-root');
    const report = () => {
      if (typeof options.onEdit === 'function') options.onEdit();
    };
    node.addEventListener('input', report);
    node.addEventListener('change', report);
    node.append(...children);
    return node;
  }

  // ---------- page chrome ----------

  /**
   * The sticky save footer: the save state on the left, Discard and Save on the right. Pass `into` (an earlier
   * result) to refill it in place. `options`: `stateLabel` (empty shows nothing), `saving`, `canDiscard`,
   * `canSave`, `onDiscard`, `onSave`, optional `saveLabel`. Save and Discard are disabled while `saving` (the Save
   * label then reads Saving…) or `busy` (disabled, label unchanged).
   */
  function saveFooter(options, into) {
    const footer = into || el('footer', null, 'mg-footer mg-save-footer');
    // A refill keeps the same nodes. A field's `change` event fires when Save takes the focus, in the middle of the
    // press; replacing the button then would drop the click, since it needs the press and the release on one node.
    if (!footer.mgParts) {
      const state = el('span', null, 'mg-save-state');
      const actions = el('div', null, 'mg-footer-actions');
      const parts = { state, handlers: {} };
      parts.discard = button('Discard changes', { kind: 'secondary', onClick: (event) => parts.handlers.onDiscard(event) });
      parts.save = button('Save workflow', { kind: 'primary', onClick: (event) => parts.handlers.onSave(event) });
      actions.append(parts.discard, parts.save);
      footer.replaceChildren(state, actions);
      footer.mgParts = parts;
    }
    const parts = footer.mgParts;
    parts.handlers.onDiscard = options.onDiscard || (() => undefined);
    parts.handlers.onSave = options.onSave || (() => undefined);
    parts.state.replaceChildren();
    if (options.stateLabel) parts.state.append(window.MigentPage.icon('circle'), options.stateLabel);
    const locked = options.saving === true || options.busy === true;
    parts.discard.disabled = locked || options.canDiscard !== true;
    parts.save.disabled = locked || options.canSave !== true;
    parts.save.textContent = options.saving ? 'Saving…' : options.saveLabel || 'Save workflow';
    return footer;
  }

  /** The area under the page header that holds banners and issue lists. */
  function notices(children) {
    const node = el('div', null, 'mg-notices');
    node.append(...children);
    return node;
  }

  /** One line of a notice: a `mg-alert` in a tone (`mg-error` or `mg-warn`); `isAlert` adds `role="alert"`. */
  function alertLine(message, tone, isAlert) {
    const node = el('p', message, 'mg-alert ' + tone);
    if (isAlert) node.setAttribute('role', 'alert');
    return node;
  }

  /**
   * The one banner: an icon and a left edge in the tone of the message. `options`: `tone` (`ok`, `info`, `warn` or
   * `error`), `icon` (defaults by tone), `lines` (the first is the message, the rest are quieter; a line is a string
   * or `{ text, className }`), `children` (nodes under the lines), `actions` (nodes under those) and `role` (`alert` for an error, `status` otherwise).
   */
  function banner(options) {
    const tone = options.tone || 'info';
    const node = el('div', null, 'mg-banner mg-banner--' + tone);
    node.setAttribute('role', options.role || (tone === 'error' ? 'alert' : 'status'));
    const defaults = { ok: 'pass', info: 'info', warn: 'warning', error: 'error' };
    const mark = el('span', null, 'mg-banner__icon');
    mark.append(window.MigentPage.icon(options.icon || defaults[tone] || 'info'));
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
        const text = parts.join(' \u00b7 ');
        main.append(el('span', text, 'mg-collapsible-summary'));
        main.setAttribute('data-tip', state.title ? state.title + ' \u2014 ' + text : text);
      }
      head.replaceChildren(badge, main, ...(tools === null ? [] : [tools]));
    };
    fill(options);
    const node = window.MigentPage.details(options.key, head, 'mg-collapsible', options.open === true, options.path);
    const body = el('div', null, 'mg-collapsible-body');
    body.append(...(options.body || []));
    node.append(body);
    node.refresh = () => {
      if (typeof options.describe === 'function') fill({ ...options, ...options.describe() });
    };
    return node;
  }

  // ---------- layout ----------

  /**
   * Give a label (or a legend's text) a hint: a dotted underline, the tooltip on hover and on keyboard focus, and
   * a hidden node with the same text for `aria-describedby`. Returns that node, which the caller places next to
   * the label. No icon: the underline is the only sign, so a form of hints stays quiet.
   */
  function hint(labelNode, text, warning, id) {
    labelNode.classList.add('mg-has-hint');
    if (warning) labelNode.classList.add('mg-has-hint--warn');
    labelNode.setAttribute('data-tip', text);
    // Focusable, so the keyboard reaches the tooltip.
    labelNode.tabIndex = 0;
    const description = el('span', text, 'mg-hint-text');
    description.id = id;
    description.hidden = true;
    return description;
  }

  /**
   * A button. `kind` is primary, secondary, quiet, link or danger; `size` is `'sm'` (compact, 24px) or `'md'`
   * (standard, 28px). A quiet or danger button is compact unless `size` says otherwise.
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
    if (settings.title) node.setAttribute('data-tip', settings.title);
    node.addEventListener('click', settings.onClick || (() => undefined));
    return node;
  }

  /**
   * One labelled control. `options.hint` is a tooltip on the label; `options.issue` is `{ message, warning }` and sets
   * `aria-invalid` and `aria-describedby` on the control. `options.wide` spans every column of a field grid.
   * `options.action` is a node at the far end of the label row, for a control or state that belongs to the field
   * but not to its value, such as an Override toggle or an "Overridden" tag.
   */
  function field(options) {
    const wrap = el('div', null, 'mg-field' + (options.wide ? ' mg-field--wide' : ''));
    const id = options.id || controlId(options.path);
    const control = options.control;
    control.id = id;
    const described = [];
    const head = el('div', null, 'mg-field-head');
    if (options.label) {
      const label = el('label', options.label, 'mg-label');
      label.htmlFor = id;
      head.append(label);
      if (options.hint) {
        head.append(hint(label, options.hint, options.hintWarning, id + '-hint'));
        described.push(id + '-hint');
      }
    }
    if (options.action) {
      const action = el('div', null, 'mg-field-action');
      action.append(options.action);
      head.append(action);
    }
    if (head.children.length > 0) wrap.append(head);
    wrap.append(control);
    if (options.issue) {
      control.setAttribute('aria-invalid', 'true');
      described.push(id + '-issue');
      const message = el('p', options.issue.message, 'mg-issue ' + (options.issue.warning ? 'mg-warn' : 'mg-error'));
      message.id = id + '-issue';
      wrap.append(message);
    }
    if (described.length > 0) control.setAttribute('aria-describedby', described.join(' '));
    return wrap;
  }

  /** A grid of fields; it reflows from one to several columns. */
  function grid(children) {
    const node = el('div', null, 'mg-field-grid');
    if (children) node.append(...children);
    return node;
  }

  /**
   * A section: one head band that titles it, then one body that holds the content. `options.level` picks the
   * heading level (2 for a page section, 3 for a block inside one). `options.variant` selects the surface:
   * `group` sits inline on the page and `card` is a bordered item such as an output or a decision route.
   * `options.surface` puts a page section's body on a card, for a section whose content has no items of its own.
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

  /** A section heading: title, an optional count chip, a note and trailing actions. */
  function sectionHead(title, options) {
    const settings = options || {};
    const head = el('div', null, 'mg-section-head');
    const body = el('div', null, 'mg-section-heading');
    const row = el('div', null, 'mg-section-title-row');
    row.append(el(settings.level === 3 ? 'h3' : 'h2', title, 'mg-section-title'));
    if (settings.count) row.append(el('span', settings.count, 'mg-chip'));
    body.append(row);
    if (settings.note) body.append(el('p', settings.note, 'mg-section-note'));
    head.append(body);
    const actions = el('div', null, 'mg-section-actions');
    for (const action of settings.actions || []) actions.append(action);
    head.append(actions);
    return head;
  }

  /**
   * A named block inside a section: the same head and body as a page section, sized down. `options.card`
   * renders it as a bordered item instead, for a repeated output, suggestion or decision route.
   */
  function group(title, note, options) {
    const settings = options || {};
    return section(title, {
      level: 3,
      note,
      variant: settings.card ? 'card' : 'group',
      accent: settings.accent,
      actions: settings.actions,
      children: settings.children,
    });
  }

  /**
   * A fieldset with a legend, for a control group inside a larger block. `options.count` is a chip beside the
   * legend, `options.hint` is a tooltip on the legend text, `options.action` is a node at the far end of the legend
   * row and `options.issue` is rendered as in `field`, against the fieldset itself, for a group of controls with no
   * input.
   */
  function fieldset(legend, children, options) {
    const settings = options || {};
    const node = el('fieldset', null, 'mg-fieldset' + (settings.className ? ' ' + settings.className : ''));
    const id = controlId(settings.path || legend);
    const described = [];
    const legendNode = el('legend', null, 'mg-legend');
    const legendText = el('span', legend);
    legendNode.append(legendText);
    if (settings.count !== undefined) legendNode.append(el('span', String(settings.count), 'mg-chip'));
    if (settings.hint) {
      legendNode.append(hint(legendText, settings.hint, settings.hintWarning, id + '-hint'));
      described.push(id + '-hint');
    }
    if (settings.action) {
      const action = el('span', null, 'mg-field-action');
      action.append(settings.action);
      legendNode.append(action);
    }
    node.append(legendNode);
    if (children) node.append(...children);
    if (settings.issue) {
      node.setAttribute('aria-invalid', 'true');
      described.push(id + '-issue');
      const message = el('p', settings.issue.message, 'mg-issue ' + (settings.issue.warning ? 'mg-warn' : 'mg-error'));
      message.id = id + '-issue';
      node.append(message);
    }
    if (described.length > 0) node.setAttribute('aria-describedby', described.join(' '));
    return node;
  }

  /** A compact link-style action with a plus icon that adds an item to a list. */
  function addButton(label, onClick, disabled) {
    const node = button('', { onClick, disabled });
    node.classList.add('mg-add');
    node.append(window.MigentPage.icon('add'), label);
    return node;
  }

  /**
   * The add action of a whole section list: a wide button with a dashed outline and a plus icon, placed at the
   * bottom of the list so it is a big target right where the new item appears. When the list is empty,
   * `options.empty` is the message to show: the block then becomes one dashed frame that holds the message and,
   * under it, the same button without an outline of its own.
   */
  function addBlockButton(label, onClick, disabled, options) {
    const node = button('', { onClick, disabled });
    node.classList.add('mg-add-block');
    node.append(window.MigentPage.icon('add'), label);
    const empty = options && options.empty;
    if (!empty) return node;
    const frame = el('div', null, 'mg-empty');
    frame.append(el('p', empty, 'mg-empty-text'), node);
    return frame;
  }

  /**
   * A quiet icon-only action (move up, move down). `label` is its accessible name and tooltip (`data-tip`); the
   * button shows no text. `path` is a `data-path`, so a repaint can put the focus back on it.
   */
  function iconButton(iconName, label, onClick, disabled, path) {
    const node = button('', { kind: 'quiet', onClick, disabled });
    if (path) node.dataset.path = path;
    node.classList.add('mg-btn--icon');
    node.append(window.MigentPage.icon(iconName));
    node.setAttribute('aria-label', label);
    node.setAttribute('data-tip', label);
    return node;
  }

  /**
   * A destructive row action drawn as a trash icon. `label` is its accessible name and tooltip (`data-tip`), so
   * name the row it removes ("Remove decision 2"); the button shows no text.
   */
  function removeButton(label, onClick, disabled) {
    const node = button('', { kind: 'danger', onClick, disabled });
    node.classList.add('mg-btn--icon');
    node.append(window.MigentPage.icon('trash'));
    node.setAttribute('aria-label', label);
    node.setAttribute('data-tip', label);
    return node;
  }

  function datalist(id, values) {
    const list = el('datalist');
    list.id = id;
    for (const value of values) {
      const option = el('option');
      option.value = value;
      list.append(option);
    }
    return list;
  }

  // ---------- editors ----------

  /**
   * A checkbox group. `options.items` is `[{ value, label, unknown, title }]`; an unknown item is shown in the
   * warning tone instead of being dropped.
   * After a change the kit calls `onRestructure(path + '.' + value)`; the form root reports the edit.
   */
  function checkboxList(options) {
    const wrap = el('div', null, 'mg-checks');
    for (const item of options.items) {
      const label = el('label', null, 'mg-check' + (item.unknown ? ' mg-check--unknown' : ''));
      label.title = item.title || (item.unknown ? item.value + ' is not a known value' : '');
      const box = el('input');
      box.type = 'checkbox';
      box.value = item.value;
      box.checked = options.selected.includes(item.value);
      box.dataset.path = options.path + '.' + item.value;
      box.disabled = options.disabled === true;
      box.addEventListener('change', () => {
        options.onChange(item.value, box.checked);
        options.onRestructure(options.path + '.' + item.value);
      });
      label.append(box, el('span', item.label === undefined ? item.value : item.label));
      wrap.append(label);
    }
    return wrap;
  }

  /**
   * A list of strings with add and remove rows. `values` is edited in place.
   * The form root reports value edits. The kit calls `options.onEdit` after add or remove and
   * `options.onRestructure(path)` to rebuild.
   * With a `label` it renders as a fieldset; without one it is a plain block inside a titled group.
   */
  function stringList(options) {
    const values = options.values;
    const wrap = options.label
      ? fieldset(options.label, [], { className: 'mg-list-editor', count: values.length, action: options.action })
      : el('div', null, 'mg-list-editor');
    const itemLabel = options.itemLabel || 'item';
    values.forEach((value, index) => {
      const row = el('div', null, 'mg-inline-row');
      const path = options.path + '.' + index;
      const control = options.multiline
        ? textarea({
            value,
            path,
            placeholder: options.placeholder,
            rows: options.rows,
            disabled: options.disabled,
            onInput: (next) => {
              values[index] = next;
            },
          })
        : text({
            value,
            path,
            placeholder: options.placeholder,
            disabled: options.disabled,
            onInput: (next) => {
              values[index] = next;
            },
          });
      control.setAttribute('aria-label', itemLabel + ' ' + (index + 1));
      const remove = removeButton(window.MigentCopy.remove(itemLabel, index + 1), () => {
        values.splice(index, 1);
        options.onEdit();
        options.onRestructure(options.path + '.' + Math.max(0, index - 1));
      }, options.disabled);
      row.append(control, remove);
      wrap.append(row);
    });
    wrap.append(
      addButton(options.addLabel, () => {
        values.push('');
        options.onEdit();
        options.onRestructure(options.path + '.' + (values.length - 1));
      }, options.disabled),
    );
    return wrap;
  }

  /**
   * A list of key/value pairs. `valueOptions(value)` returns select choices; without it the value is free text.
   * The kit edits `pairs` in place. The form root reports value edits; add and remove call `onEdit` and then
   * `onRestructure(path)`.
   */
  function pairList(options) {
    const pairs = options.pairs;
    const wrap = options.label
      ? fieldset(options.label, [], { className: 'mg-list-editor', count: pairs.length, action: options.action })
      : el('div', null, 'mg-list-editor');
    const itemLabel = options.itemLabel || 'item';
    pairs.forEach((pair, index) => {
      const row = el('div', null, 'mg-inline-row');
      const path = options.path + '.' + index;
      const key = text({
        value: pair.key,
        path: path + '.key',
        placeholder: options.keyPlaceholder,
        list: options.keyList,
        disabled: options.disabled,
        onInput: (next) => {
          pair.key = next;
        },
      });
      key.setAttribute('aria-label', itemLabel + ' ' + (index + 1) + ' key');
      let value;
      if (typeof options.valueOptions === 'function') {
        value = select({
          value: pair.value,
          path: path + '.value',
          options: options.valueOptions(pair.value),
          disabled: options.disabled,
          onInput: (next) => {
            pair.value = next;
          },
        });
      } else {
        value = text({
          value: pair.value,
          path: path + '.value',
          placeholder: options.valuePlaceholder,
          disabled: options.disabled,
          onInput: (next) => {
            pair.value = next;
          },
        });
      }
      value.setAttribute('aria-label', itemLabel + ' ' + (index + 1) + ' value');
      const remove = removeButton(window.MigentCopy.remove(itemLabel, index + 1), () => {
        pairs.splice(index, 1);
        options.onEdit();
        options.onRestructure(options.path + '.' + Math.max(0, index - 1));
      }, options.disabled);
      row.append(key, value, remove);
      wrap.append(row);
    });
    wrap.append(
      addButton(options.addLabel, () => {
        pairs.push({ key: '', value: '' });
        options.onEdit();
        options.onRestructure(options.path + '.' + (pairs.length - 1) + '.key');
      }, options.disabled),
    );
    return wrap;
  }

  window.MigentForm = {
    text,
    number,
    textarea,
    select,
    picker,
    root,
    saveFooter,
    collapsibleCard,
    notices,
    alertLine,
    banner,
    issueBanner,
    field,
    grid,
    group,
    section,
    fieldset,
    hint,
    button,
    addButton,
    addBlockButton,
    iconButton,
    removeButton,
    datalist,
    checkboxList,
    stringList,
    pairList,
  };
})();
