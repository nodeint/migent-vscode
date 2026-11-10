// Host adapter of Migent webview pages. Loaded after the kit, before the page's own script (see docs/ui.md).
// This is, with draftpage.js, the only place that touches `acquireVsCodeApi`, `postMessage` and the `message` event.
// Exposes one global, `MigentPage`: `connect` and `trackFooter`. It builds no component; those are in `MigentUi`.
(function () {
  'use strict';

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
   * Returns `{ send, post, action }`; `action(label, intent, kind)` is a kit button that sends `intent`. `send(intent)` posts `{ type: 'intent', revision, ...intent }`. `post(message)`
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

    /** A kit button that sends `intent` when pressed. `kind` is a kit button kind. */
    function action(label, intent, kind) {
      return window.MigentUi.button(label, { kind, size: 'md', onClick: () => send(intent) });
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
    return { send, post, action };
  }

  window.MigentPage = { connect, trackFooter };
})();
