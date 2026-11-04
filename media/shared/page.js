// Shared page helpers for Migent webview pages. Loaded before the page's own script (see docs/ui.md).
// Exposes one global, `MigentPage`. Every string is set with textContent; nothing here builds HTML.
(function () {
  'use strict';

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

  /**
   * Connect a page to the extension: one `acquireVsCodeApi` handle, the revision guard, `setState(identity)`
   * and the `ready` handshake. `render(model)` is called for each newer model message.
   * Returns `{ send, button }`; `send` always carries the current revision.
   */
  function connect(options) {
    const vscode = acquireVsCodeApi();
    let revision = -1;

    function send(intent) {
      vscode.postMessage({ ...intent, type: 'intent', revision });
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
      options.render(message.model);
    });

    vscode.postMessage({ type: 'ready' });
    return { send, button };
  }

  // Open/closed state of <details>, kept in memory so a model re-render does not collapse them.
  const detailsOpen = new Map();

  /** A collapsible block (<details>/<summary>) that stays as the user left it across re-renders. */
  function details(key, summaryText, className) {
    const node = el('details', null, 'mg-details' + (className ? ' ' + className : ''));
    node.open = detailsOpen.get(key) === true;
    node.append(el('summary', summaryText));
    node.addEventListener('toggle', () => detailsOpen.set(key, node.open));
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

  window.MigentPage = { el, section, connect, details, menuButton };
})();
