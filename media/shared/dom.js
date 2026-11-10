// DOM basics of the Migent UI kit: node creation, icons, the shared tooltip and control lookup by form path.
// Kit group (see docs/ui.md): it knows no host, no model and no component. Needs icons.js loaded first.
// Contributes `el`, `icon`, `controlOf`, `revealControl` and `openAround` to `window.MigentUi`. Every string is set
// with textContent; nothing here builds HTML.
(function () {
  'use strict';

  /** Create an element. `text` and `className` are optional. */
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

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

  /**
   * The control a form path edits inside `root`: the `[data-path]` node that matches, or the nearest one around it
   * (the path loses its last part until a control matches). It never falls back to the first part, so a path the
   * form has no control for (such as `roles.reviewer`) finds nothing. Returns null when there is none.
   */
  function controlOf(root, path) {
    if (!root) return null;
    const parts = String(path).split('.');
    while (parts.length > 1) {
      const node = root.querySelector('[data-path="' + parts.join('.').replaceAll('"', '') + '"]');
      if (node) return node;
      parts.pop();
    }
    return null;
  }

  /**
   * Take the reader to a control: the cards around it open first (the shared `details` keeps that state across a
   * repaint), then it is scrolled to the middle of the view and focused.
   */
  function revealControl(node) {
    openAround(node);
    node.scrollIntoView({ block: 'center' });
    node.focus({ preventScroll: true });
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

  window.MigentUi = Object.assign(window.MigentUi || {}, { el, icon, openAround, controlOf, revealControl });
})();
