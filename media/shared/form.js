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

  // ---------- layout ----------

  /** A compact hint for a control: a filled question icon whose tooltip carries the text. */
  function hint(text, warning) {
    const node = el('span', null, 'mg-hint-icon' + (warning ? ' mg-hint-icon--warn' : ''));
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', text);
    node.title = text;
    node.append(window.MigentPage.icon('question-filled'));
    return node;
  }

  /** A button; `kind` is a modifier such as primary, secondary or quiet. */
  function button(label, options) {
    const settings = options || {};
    const node = el('button', label, 'mg-btn' + (settings.kind ? ' mg-btn--' + settings.kind : ''));
    node.type = 'button';
    node.disabled = settings.disabled === true;
    if (settings.title) node.title = settings.title;
    node.addEventListener('click', settings.onClick || (() => undefined));
    return node;
  }

  /**
   * One labelled control. `options.hint` is a tooltip icon; `options.issue` is `{ message, warning }` and sets
   * `aria-invalid` and `aria-describedby` on the control. `options.wide` spans every column of a field grid.
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
    }
    if (options.hint) {
      const icon = hint(options.hint, options.hintWarning);
      icon.id = id + '-hint';
      head.append(icon);
      described.push(icon.id);
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
   * A fieldset with a legend, for a control group inside a larger block. `options.hint` is a note tooltip and
   * `options.issue` is rendered as in `field`, against the fieldset itself, for a group of controls with no input.
   */
  function fieldset(legend, children, options) {
    const settings = options || {};
    const node = el('fieldset', null, 'mg-fieldset' + (settings.className ? ' ' + settings.className : ''));
    const id = controlId(settings.path || legend);
    const described = [];
    const legendNode = el('legend', null, 'mg-legend');
    legendNode.append(el('span', legend));
    if (settings.hint) {
      const icon = hint(settings.hint, settings.hintWarning);
      icon.id = id + '-hint';
      legendNode.append(icon);
      described.push(icon.id);
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

  /** A full-width dashed row that adds an item to a list. */
  function addButton(label, onClick, disabled) {
    const node = button(label, { onClick, disabled });
    node.classList.add('mg-add');
    return node;
  }

  /** A quiet row action. `label` is its accessible name; the visible text stays short. */
  function removeButton(label, onClick, disabled) {
    const node = button('Remove', { kind: 'quiet', onClick, disabled });
    node.setAttribute('aria-label', label);
    node.title = label;
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
   * After a change the kit calls `onEdit` and then `onRestructure(path + '.' + value)`.
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
        options.onEdit();
        options.onRestructure(options.path + '.' + item.value);
      });
      label.append(box, el('span', item.label === undefined ? item.value : item.label));
      wrap.append(label);
    }
    return wrap;
  }

  /**
   * A list of strings with add and remove rows. `values` is edited in place.
   * The kit calls `options.onEdit` after every edit and `options.onRestructure(path)` after add or remove.
   * With a `label` it renders as a fieldset; without one it is a plain block inside a titled group.
   */
  function stringList(options) {
    const values = options.values;
    const wrap = options.label ? fieldset(options.label, []) : el('div', null, 'mg-list-editor');
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
              options.onEdit();
            },
          })
        : text({
            value,
            path,
            placeholder: options.placeholder,
            disabled: options.disabled,
            onInput: (next) => {
              values[index] = next;
              options.onEdit();
            },
          });
      control.setAttribute('aria-label', itemLabel + ' ' + (index + 1));
      const remove = removeButton('Remove ' + itemLabel + ' ' + (index + 1), () => {
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
   * The kit edits `pairs` in place and calls `onEdit` after every edit and `onRestructure(path)` after add or remove.
   */
  function pairList(options) {
    const pairs = options.pairs;
    const wrap = options.label ? fieldset(options.label, []) : el('div', null, 'mg-list-editor');
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
          options.onEdit();
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
            options.onEdit();
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
            options.onEdit();
          },
        });
      }
      value.setAttribute('aria-label', itemLabel + ' ' + (index + 1) + ' value');
      const remove = removeButton('Remove ' + itemLabel + ' ' + (index + 1), () => {
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
    field,
    grid,
    group,
    section,
    fieldset,
    hint,
    button,
    addButton,
    removeButton,
    datalist,
    checkboxList,
    stringList,
    pairList,
  };
})();
