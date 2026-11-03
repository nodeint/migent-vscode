// Answer-questions page. All content is rendered with textContent; the host validates every message again.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let model = null;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key === 'on') for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
      else if (value === true) node.setAttribute(key, '');
      else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    for (const child of children || []) node.append(child);
    return node;
  }

  function draftOf(id) {
    return model.draft[id] || { mode: 'choice', selected: [], text: '' };
  }

  function send(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  function edit(id, patch) {
    const next = Object.assign({}, draftOf(id), patch);
    model.draft[id] = next;
    send('edit', { generation: model.generation, fingerprint: model.fingerprint, questionId: id, draft: next });
    updateChrome();
  }

  // Live counter only; the host revalidates and decides whether Send is allowed.
  function completeness() {
    return model.questions.map((q) => {
      const d = draftOf(q.id);
      return d.mode === 'text' ? d.text.trim().length > 0 : d.selected.length > 0;
    });
  }

  function updateChrome() {
    const done = completeness();
    const count = done.filter(Boolean).length;
    const counter = document.getElementById('counter');
    if (counter) counter.textContent = count + '/' + model.questions.length + ' answered';
    model.questions.forEach((q, index) => {
      const jump = document.getElementById('jump-' + q.id);
      if (jump) jump.className = done[index] ? 'done' : '';
    });
    const submitButton = document.getElementById('submit');
    if (submitButton) submitButton.disabled = !(model.canSubmit && count === model.questions.length);
  }

  function optionRow(q, option) {
    const d = draftOf(q.id);
    const input = el('input', {
      type: q.selection === 'single' ? 'radio' : 'checkbox',
      name: 'q' + q.id,
      id: 'q' + q.id + option.id,
      checked: d.mode === 'choice' && d.selected.includes(option.id),
      disabled: !model.editable || d.mode === 'text',
      'aria-describedby': option.description ? 'd' + q.id + option.id : null,
      on: {
        change: (event) => {
          const current = draftOf(q.id).selected;
          let selected;
          if (q.selection === 'single') selected = [option.id];
          else if (event.target.checked) selected = q.options.map((o) => o.id).filter((id) => id === option.id || current.includes(id));
          else selected = current.filter((id) => id !== option.id);
          edit(q.id, { selected });
        },
      },
    });
    const label = el('label', { class: 'opt', for: input.id }, [input, document.createTextNode(' ' + option.id + '. ' + option.label)]);
    if (q.recommended.includes(option.id)) label.append(el('span', { class: 'badge', text: 'Recommended' }));
    if (option.description) label.append(el('span', { class: 'desc', id: 'd' + q.id + option.id, text: option.description }));
    return label;
  }

  function card(q) {
    const d = draftOf(q.id);
    const legend = el('legend', {}, [
      document.createTextNode(q.id + '. ' + q.question),
      el('span', { class: 'mode', text: q.selection === 'single' ? 'Choose one' : 'Choose one or more' }),
    ]);
    const box = el('fieldset', { class: 'card', id: 'card-' + q.id }, [legend]);
    if (q.context) {
      const ctx = el('div', { class: 'context', text: q.context });
      box.append(ctx);
      if (q.context.length > 240) {
        box.append(el('button', { type: 'button', text: 'Show more context', on: { click: () => ctx.classList.toggle('open') } }));
      }
    }
    for (const option of q.options) box.append(optionRow(q, option));
    const other = el('input', {
      type: 'checkbox',
      id: 'other' + q.id,
      checked: d.mode === 'text',
      disabled: !model.editable,
      on: {
        change: (event) => {
          edit(q.id, { mode: event.target.checked ? 'text' : 'choice' });
          rerender();
        },
      },
    });
    box.append(el('label', { class: 'opt', for: other.id }, [other, document.createTextNode(' Other â€” write an answer')]));
    if (d.mode === 'text') {
      const area = el('textarea', {
        id: 'text' + q.id,
        'aria-label': 'Your answer to question ' + q.id,
        disabled: !model.editable,
        on: { input: (event) => edit(q.id, { text: event.target.value }) },
      });
      area.value = d.text;
      box.append(area);
      if (model.ambiguous.includes(q.id)) {
        box.append(el('div', { class: 'status warn', role: 'status', text: 'This text equals an option letter, so the CLI will read it as that option.' }));
      }
    }
    if (model.recorded && model.recorded[q.id] !== undefined) {
      box.append(el('div', { class: 'recorded', text: 'Recorded: ' + model.recorded[q.id] }));
    }
    return box;
  }

  function note() {
    if (!model.message && !model.blockReason) return null;
    const warn = ['rejected', 'unconfirmed', 'stale', 'answered-elsewhere', 'unavailable', 'recorded-waiting'].includes(model.state);
    const node = el('div', { class: 'status' + (warn ? ' warn' : ''), role: 'status', text: model.message || model.blockReason });
    if (model.message && model.blockReason && model.editable) node.append(el('div', { text: model.blockReason }));
    return node;
  }

  function archivedSection() {
    const box = el('details', { class: 'card' }, [el('summary', { text: 'Previous draft (read-only)' })]);
    for (const item of model.archived) {
      box.append(el('p', { text: item.id + '. ' + item.question + ' — ' + (item.answer || 'no answer') }));
    }
    return box;
  }

  function footer() {
    const bar = el('footer', {}, [el('span', { id: 'counter' }), el('span', { class: 'spacer' })]);
    const add = (label, type, cls) =>
      bar.append(el('button', { type: 'button', text: label, class: cls || '', on: { click: () => send(type) } }));
    if (model.state === 'stale') add('Load current questions', 'reload', 'primary');
    if (model.state === 'unconfirmed') add('Recheck', 'recheck', 'primary');
    if (model.state === 'recorded-waiting') add('Continue', 'continue', 'primary');
    if (['recorded-waiting', 'rejected', 'unconfirmed'].includes(model.state)) add('View log', 'viewLog');
    if (model.editable || model.state === 'stale') add('Discard draft', 'discard');
    add('Questions file', 'openQuestions');
    add('Later', 'later');
    if (model.editable && model.state !== 'unconfirmed') {
      bar.append(el('button', { type: 'button', id: 'submit', class: 'primary', text: 'Submit & continue session', disabled: true, on: { click: submit } }));
    }
    return bar;
  }

  function submit() {
    if (model.canSubmit) send('submit', { revision: model.revision, fingerprint: model.fingerprint });
  }

  function rerender() {
    if (!model) return;
    const active = document.activeElement;
    const focusId = active && active.id;
    const caret = active && active.tagName === 'TEXTAREA' ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = window.scrollY;
    root.replaceChildren();
    root.append(el('header', {}, [el('h1', { text: model.title }), el('div', { class: 'crumb', text: model.crumb })]));
    const status = note();
    if (status) root.append(status);
    const jumps = el('nav', { class: 'jumps', 'aria-label': 'Questions' });
    for (const q of model.questions) {
      jumps.append(el('button', {
        type: 'button', id: 'jump-' + q.id, text: q.id, 'aria-label': 'Go to question ' + q.id,
        on: { click: () => document.getElementById('card-' + q.id).scrollIntoView() },
      }));
    }
    root.append(jumps);
    for (const q of model.questions) root.append(card(q));
    if (model.archived) root.append(archivedSection());
    root.append(footer());
    updateChrome();
    window.scrollTo(0, scroll);
    if (focusId) {
      const node = document.getElementById(focusId);
      if (node) {
        node.focus();
        if (caret && node.tagName === 'TEXTAREA') node.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'model' || !message.model) return;
    if (model && message.model.revision <= model.revision) return;
    const previous = model;
    model = message.model;
    if (message.identity) vscode.setState(message.identity);
    // The local draft is newer than the host's echo of it, until the host replaces the draft (new generation).
    if (previous && previous.generation === model.generation && previous.fingerprint === model.fingerprint) {
      model.draft = previous.draft;
    }
    // State, diagnostics and controls always apply; rerender keeps the focus, caret and scroll position.
    rerender();
  });

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && model && model.editable) submit();
  });

  vscode.postMessage({ type: 'ready' });
})();
