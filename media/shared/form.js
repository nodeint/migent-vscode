// Form controls of the Migent UI kit: inputs, fields, control groups and list editors. Kit group (see docs/ui.md):
// it builds controls and layout only, the page owns the data, validation and repaint, and it knows no host.
// Needs dom.js, components.js and copy.js loaded first. Contributes to `window.MigentUi`. Every string is set with
// textContent.
(function () {
  'use strict';

  const { el, icon, removeButton, addButton, chip } = window.MigentUi;
  const copy = window.MigentCopy;

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
      : [{ value: current, label: current === '' ? copy.kit.none : current + copy.kit.notInList }, ...choices];
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
    node.append(label, icon('chevron-down'));
    node.addEventListener('click', () => options.onPick());
    return node;
  }

  /**
   * The root of a form. One delegated `input` and `change` listener reports every value edit inside it through
   * `options.onEdit`, so a control never has to remember to. The control's own listener runs first (it is deeper),
   * so the draft already holds the new value when `onEdit` runs. Add, remove and pick actions are clicks, not
   * value edits, and still call `onEdit` themselves. The node lays out as its children (`display: contents`).
   */
  function root(options) {
    const node = el('div', null, 'mg-form-root');
    const report = () => {
      if (typeof options.onEdit === 'function') options.onEdit();
    };
    node.addEventListener('input', report);
    node.addEventListener('change', report);
    node.append(...(options.children || []));
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
   * One labelled control. `options.hint` is a tooltip on the label; `options.issue` is `{ message, warning }` and sets
   * `aria-invalid` and `aria-describedby` on the control. `options.wide` spans every column of a field grid.
   * `options.action` is a node at the far end of the label row, for a control or state that belongs to the field
   * but not to its value, such as an Override toggle or an "Overridden" tag. `options.density` is `'roomy'` for the
   * page's spacious form rhythm; the kit owns the gap, so a page never restyles it.
   */
  function field(options) {
    const wrap = el('div', null, 'mg-field' + (options.wide ? ' mg-field--wide' : '') + (options.density === 'roomy' ? ' mg-field--roomy' : ''));
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

  /**
   * A grid of fields; it reflows from one to several columns. `options.density` is `'roomy'` for the page's
   * spacious form rhythm and applies to every field in the grid.
   */
  function grid(children, options) {
    const settings = options || {};
    const node = el('div', null, 'mg-field-grid' + (settings.density === 'roomy' ? ' mg-field-grid--roomy' : ''));
    if (children) node.append(...children);
    return node;
  }

  /**
   * A fieldset with a legend, for a control group inside a larger block. `options.count` is a chip beside the
   * legend, `options.hint` is a tooltip on the legend text, `options.action` is a node at the far end of the legend
   * row and `options.issue` is rendered as in `field`, against the fieldset itself, for a group of controls with no
   * input.
   */
  function fieldset(legend, options) {
    const settings = options || {};
    const node = el('fieldset', null, 'mg-fieldset' + (settings.className ? ' ' + settings.className : ''));
    const id = controlId(settings.path || legend);
    const described = [];
    const legendNode = el('legend', null, 'mg-legend');
    const legendText = el('span', legend);
    legendNode.append(legendText);
    if (settings.count !== undefined) legendNode.append(chip(String(settings.count)));
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
    if (settings.children) node.append(...settings.children);
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

  /**
   * A labeled tag for the far end of a field's label row, such as the value another file overrides.
   * `options`: `tone` (`warn`, the default, or `info`), `icon` (a codicon), `tip` (the tooltip and the tail of the
   * accessible name). Focusable, so the keyboard reaches the tooltip.
   */
  function fieldTag(label, options) {
    const settings = options || {};
    const node = el('span', null, 'mg-field-tag' + (settings.tone === 'info' ? ' mg-field-tag--info' : ''));
    if (settings.icon) node.append(icon(settings.icon));
    node.append(el('span', label));
    if (settings.tip) node.dataset.tip = settings.tip;
    node.setAttribute('aria-label', settings.tip ? label + '. ' + settings.tip : label);
    node.tabIndex = 0;
    return node;
  }

  /**
   * A compact checkbox for the field-action slot. The kit only reports `onChange(checked)`; the page keeps the
   * meaning of the flag and its copy. `options`: `checked`, `path`, `ariaLabel`, `onChange`, `disabled`.
   */
  function fieldToggle(label, options) {
    const settings = options || {};
    const wrap = el('label', null, 'mg-field-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = settings.checked === true;
    box.disabled = settings.disabled === true;
    if (settings.path) box.dataset.path = settings.path;
    if (settings.ariaLabel) box.setAttribute('aria-label', settings.ariaLabel);
    box.addEventListener('change', () => {
      if (typeof settings.onChange === 'function') settings.onChange(box.checked);
    });
    wrap.append(box, el('span', label));
    return wrap;
  }

  function datalist(options) {
    const list = el('datalist');
    list.id = options.id;
    for (const value of options.values) {
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
      label.title = item.title || (item.unknown ? item.value + copy.kit.notKnownValue : '');
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
      ? fieldset(options.label, { className: 'mg-list-editor', count: values.length, action: options.action })
      : el('div', null, 'mg-list-editor');
    const itemLabel = options.itemLabel || copy.kit.item;
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
      const remove = removeButton(copy.remove(itemLabel, index + 1), {
        onClick: () => {
          values.splice(index, 1);
          options.onEdit();
          options.onRestructure(options.path + '.' + Math.max(0, index - 1));
        },
        disabled: options.disabled,
      });
      row.append(control, remove);
      wrap.append(row);
    });
    wrap.append(
      addButton(options.addLabel, {
        onClick: () => {
          values.push('');
          options.onEdit();
          options.onRestructure(options.path + '.' + (values.length - 1));
        },
        disabled: options.disabled,
      }),
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
      ? fieldset(options.label, { className: 'mg-list-editor', count: pairs.length, action: options.action })
      : el('div', null, 'mg-list-editor');
    const itemLabel = options.itemLabel || copy.kit.item;
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
      key.setAttribute('aria-label', copy.kit.rowKey(itemLabel, index + 1));
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
      value.setAttribute('aria-label', copy.kit.rowValue(itemLabel, index + 1));
      const remove = removeButton(copy.remove(itemLabel, index + 1), {
        onClick: () => {
          pairs.splice(index, 1);
          options.onEdit();
          options.onRestructure(options.path + '.' + Math.max(0, index - 1));
        },
        disabled: options.disabled,
      });
      row.append(key, value, remove);
      wrap.append(row);
    });
    wrap.append(
      addButton(options.addLabel, {
        onClick: () => {
          pairs.push({ key: '', value: '' });
          options.onEdit();
          options.onRestructure(options.path + '.' + (pairs.length - 1) + '.key');
        },
        disabled: options.disabled,
      }),
    );
    return wrap;
  }

  window.MigentUi = Object.assign(window.MigentUi || {}, {
    text,
    number,
    select,
    picker,
    datalist,
    root,
    field,
    grid,
    fieldTag,
    fieldToggle,
    fieldset,
    checkboxList,
    stringList,
    pairList,
  });
})();
