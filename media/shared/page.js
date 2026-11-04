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
   * It starts closed unless `isOpenByDefault` is true and the reader has not toggled it yet.
   */
  function details(key, summaryText, className, isOpenByDefault) {
    const node = el('details', null, 'mg-details' + (className ? ' ' + className : ''));
    node.open = detailsOpen.has(key) ? detailsOpen.get(key) === true : isOpenByDefault === true;
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

  // Status icon and tone per session state. The text is always shown too, so color is never the only signal.
  const STATUS = {
    completed: { icon: '✓', tone: 'ok' },
    failed: { icon: '✗', tone: 'error' },
    running: { icon: '●', tone: 'info' },
    stopped: { icon: '■', tone: 'warn' },
  };

  function statusIndicator(state) {
    const known = STATUS[state.toLowerCase()] || { icon: '○', tone: 'info' };
    const node = el('span', null, 'mg-status mg-status--' + known.tone);
    const icon = el('span', known.icon);
    icon.setAttribute('aria-hidden', 'true');
    node.append(icon, el('span', state));
    return node;
  }

  function sessionAction(name) {
    return { intent: 'sessionAction', action: name };
  }

  /**
   * The header shared by the Results and Session Metrics pages: status, title, subtitle, two page buttons
   * (Results, Metrics) and a more menu (Open task, View log, Copy session ID, Reveal in Explorer, then
   * `options.menuItems`). `options.current` is 'results' or 'metrics'; that page's button is disabled and needs
   * no intent. `options.openResults` and `options.openMetrics` are the intents of the other button.
   */
  function sessionHeader(page, options) {
    const header = el('header', null, 'mg-header');
    header.append(statusIndicator(options.state), el('h1', options.title, 'mg-title'));
    header.append(el('p', options.subtitle.filter((part) => part).join(' · '), 'mg-subtitle'));
    const actions = el('div', null, 'mg-actions');
    for (const tab of [
      { key: 'results', label: 'Results', intent: options.openResults },
      { key: 'metrics', label: 'Metrics', intent: options.openMetrics },
    ]) {
      const node = page.button(tab.label, tab.intent, 'mg-btn mg-btn--secondary');
      if (tab.key === options.current) {
        node.disabled = true;
        node.setAttribute('aria-current', 'page');
      }
      actions.append(node);
    }
    const send = (name) => () => page.send(sessionAction(name));
    actions.append(
      menuButton({
        label: '⋯',
        ariaLabel: 'More actions',
        items: [
          { label: 'Open task', onSelect: send('openTask') },
          { label: 'View log', onSelect: send('showLog') },
          { label: 'Copy session ID', onSelect: send('copyId') },
          { label: 'Reveal in Explorer', onSelect: send('revealInExplorer') },
          ...options.menuItems,
        ],
      }),
    );
    header.append(actions);
    return header;
  }

  window.MigentPage = { el, section, connect, details, menuButton, trackFooter, sessionHeader };
})();
