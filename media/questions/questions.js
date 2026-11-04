// Answer-questions page. All content is rendered with textContent; the host validates every message again.
// The shared helpers in media/shared/page.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, details, connect, trackFooter, sessionHeader, icon } = window.MigentPage;
  const root = document.getElementById('root');
  const CONTEXT_CLAMP_LENGTH = 240;
  const WARN_STATES = ['rejected', 'unconfirmed', 'stale', 'answered-elsewhere', 'unavailable', 'recorded-waiting'];
  // Icon, tone and text per state. Icons and tones are the session vocabulary (MigentPage.sessionStates): waiting
  // for the user is the yellow question bubble, work in progress the blue sync, recorded the green check.
  const STATES = {
    editing: { icon: 'comment-discussion', tone: 'warn', text: 'Answering' },
    sending: { icon: 'sync', tone: 'info', spin: true, text: 'Sending' },
    recorded: { icon: 'pass', tone: 'ok', text: 'Recorded' },
    continuing: { icon: 'sync', tone: 'info', spin: true, text: 'Continuing' },
    'recorded-waiting': { icon: 'warning', tone: 'warn', text: 'Recorded, not continued' },
    rejected: { icon: 'error', tone: 'error', text: 'Rejected' },
    unconfirmed: { icon: 'warning', tone: 'warn', text: 'Not confirmed' },
    stale: { icon: 'warning', tone: 'warn', text: 'Out of date' },
    'answered-elsewhere': { icon: 'warning', tone: 'warn', text: 'Answered elsewhere' },
    unavailable: { icon: 'error', tone: 'error', text: 'Unavailable' },
  };
  let model = null;
  // Context blocks the reader expanded; kept across re-renders.
  const expandedContext = new Set();
  let page = null;

  function draftOf(id) {
    return model.draft[id] || { mode: 'choice', selected: [], text: '' };
  }

  function edit(id, patch) {
    const next = Object.assign({}, draftOf(id), patch);
    model.draft[id] = next;
    page.post({ type: 'edit', generation: model.generation, fingerprint: model.fingerprint, questionId: id, draft: next });
    updateChrome();
  }

  // Live counter only; the host revalidates and decides whether Send is allowed.
  function completeness() {
    return model.questions.map((q) => {
      const d = draftOf(q.id);
      return d.mode === 'text' ? d.text.trim().length > 0 : d.selected.length > 0;
    });
  }

  function canSend(count) {
    return model.canSubmit && count === model.questions.length;
  }

  function updateChrome() {
    const done = completeness();
    const count = done.filter(Boolean).length;
    const counter = document.getElementById('counter');
    if (counter) counter.textContent = counterText();
    model.questions.forEach((q, index) => {
      const jump = document.getElementById('jump-' + q.id);
      if (!jump) return;
      jump.replaceChildren(...(done[index] ? [icon('pass')] : []), q.id);
      jump.setAttribute('aria-label', 'Go to question ' + q.id + (done[index] ? ' (answered)' : ' (not answered)'));
    });
    const submitButton = document.getElementById('submit');
    if (submitButton) submitButton.disabled = !canSend(count);
  }

  function optionRow(q, option) {
    const d = draftOf(q.id);
    const input = el('input');
    input.type = q.selection === 'single' ? 'radio' : 'checkbox';
    input.name = 'q' + q.id;
    input.id = 'q' + q.id + option.id;
    input.checked = d.mode === 'choice' && d.selected.includes(option.id);
    input.disabled = !model.editable || d.mode === 'text';
    if (option.description) input.setAttribute('aria-describedby', 'd' + q.id + option.id);
    input.addEventListener('change', (event) => {
      const current = draftOf(q.id).selected;
      let selected;
      if (q.selection === 'single') selected = [option.id];
      else if (event.target.checked) selected = q.options.map((o) => o.id).filter((id) => id === option.id || current.includes(id));
      else selected = current.filter((id) => id !== option.id);
      edit(q.id, { selected });
    });
    const label = el('label', null, 'q-option');
    label.htmlFor = input.id;
    label.append(input, ' ' + option.id + '. ' + option.label);
    if (q.recommended.includes(option.id)) label.append(el('span', 'Recommended', 'mg-pill'));
    if (option.description) {
      const desc = el('span', option.description, 'q-option-desc mg-muted');
      desc.id = 'd' + q.id + option.id;
      label.append(desc);
    }
    return label;
  }

  function contextBlock(q) {
    const wrapper = el('div');
    const isLong = q.context.length > CONTEXT_CLAMP_LENGTH;
    const isOpen = expandedContext.has(q.id);
    const ctx = el('div', q.context, 'q-context mg-muted' + (isLong && !isOpen ? ' q-context--clamped' : ''));
    ctx.id = 'ctx-' + q.id;
    wrapper.append(ctx);
    if (isLong) {
      const toggle = el('button', isOpen ? 'Show less context' : 'Show more context', 'mg-btn mg-btn--link');
      toggle.id = 'ctxbtn-' + q.id;
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', ctx.id);
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.addEventListener('click', () => {
        if (expandedContext.has(q.id)) expandedContext.delete(q.id);
        else expandedContext.add(q.id);
        const open = expandedContext.has(q.id);
        ctx.classList.toggle('q-context--clamped', !open);
        toggle.textContent = open ? 'Show less context' : 'Show more context';
        toggle.setAttribute('aria-expanded', String(open));
      });
      wrapper.append(toggle);
    }
    return wrapper;
  }

  function otherRow(q, d) {
    const other = el('input');
    other.type = 'checkbox';
    other.id = 'other' + q.id;
    other.checked = d.mode === 'text';
    other.disabled = !model.editable;
    other.addEventListener('change', (event) => {
      edit(q.id, { mode: event.target.checked ? 'text' : 'choice' });
      rerender();
    });
    const label = el('label', null, 'q-option');
    label.htmlFor = other.id;
    label.append(other, ' Other — write an answer');
    return label;
  }

  function question(q) {
    const d = draftOf(q.id);
    const legend = el('legend', q.id + '. ' + q.question);
    legend.append(el('span', q.selection === 'single' ? 'Choose one' : 'Choose one or more', 'q-mode mg-muted'));
    const box = el('fieldset', null, 'q-question');
    box.id = 'card-' + q.id;
    box.append(legend);
    if (q.context) box.append(contextBlock(q));
    for (const option of q.options) box.append(optionRow(q, option));
    box.append(otherRow(q, d));
    if (d.mode === 'text') {
      const area = el('textarea', null, 'mg-input q-text');
      area.id = 'text' + q.id;
      area.setAttribute('aria-label', 'Your answer to question ' + q.id);
      area.disabled = !model.editable;
      area.value = d.text;
      area.addEventListener('input', (event) => edit(q.id, { text: event.target.value }));
      box.append(area);
      if (model.ambiguous.includes(q.id)) {
        const warning = el('p', null, 'mg-alert mg-warn');
        warning.append(icon('warning'), ' This text equals an option letter, so the CLI will read it as that option.');
        warning.setAttribute('role', 'status');
        box.append(warning);
      }
    }
    if (model.recorded && model.recorded[q.id] !== undefined) {
      const recorded = el('div', null, 'q-recorded');
      recorded.append(icon('pass'), ' Recorded: ' + model.recorded[q.id]);
      box.append(recorded);
    }
    return box;
  }

  function counterText() {
    const count = completeness().filter(Boolean).length;
    return count + '/' + model.questions.length + ' answered';
  }

  function header() {
    return sessionHeader(page, {
      state: model.sessionState,
      title: model.title,
      workflowId: model.workflowId,
      meta: model.meta,
      current: 'questions',
      tabs: [
        { key: 'questions', label: 'Questions' },
        { key: 'results', label: 'Results', onSelect: () => page.post({ type: 'openResults' }) },
        { key: 'metrics', label: 'Metrics', onSelect: () => page.post({ type: 'openMetrics' }) },
      ],
      sendAction: (action) => page.post({ type: 'sessionAction', action }),
    });
  }

  function note() {
    if (!model.message && !model.blockReason) return null;
    const isWarning = WARN_STATES.includes(model.state);
    const node = el('p', model.message || model.blockReason, 'mg-alert' + (isWarning ? ' mg-warn' : ''));
    node.setAttribute('role', 'status');
    if (model.message && model.blockReason && model.editable) node.append(el('div', model.blockReason));
    return node;
  }

  // The batch's own state is the page's, not the session's: progress, and the state once it is not Answering.
  function progressChip() {
    const known = STATES[model.state] || { icon: 'question', tone: 'muted', text: model.state };
    const chip = el('span', null, 'q-progress');
    const count = el('span', counterText());
    count.id = 'counter';
    chip.append(icon('checklist'), count);
    if (model.state !== 'editing') {
      const state = el('span', null, 'mg-status mg-status--' + known.tone);
      state.append(icon(known.icon, known.spin), el('span', known.text));
      chip.append(state);
    }
    return chip;
  }

  function jumps() {
    const nav = el('nav', null, 'q-jumps');
    nav.setAttribute('aria-label', 'Questions');
    nav.append(progressChip());
    for (const q of model.questions) {
      const jump = el('button', q.id, 'q-jump');
      jump.type = 'button';
      jump.id = 'jump-' + q.id;
      jump.addEventListener('click', () => document.getElementById('card-' + q.id).scrollIntoView());
      nav.append(jump);
    }
    return nav;
  }

  function archivedSection() {
    const box = details('archived', 'Previous draft (read-only)');
    box.querySelector('summary').id = 'archived-summary';
    for (const item of model.archived) {
      box.append(el('p', item.id + '. ' + item.question + ' — ' + (item.answer || 'no answer'), 'q-archived'));
    }
    return box;
  }

  function footer() {
    const bar = el('footer', null, 'mg-footer');
    const add = (label, type, kind) => {
      const node = el('button', label, 'mg-btn mg-btn--' + (kind || 'secondary'));
      node.type = 'button';
      node.id = 'act-' + type;
      node.addEventListener('click', () => page.post({ type }));
      bar.append(node);
    };
    if (model.state === 'stale') add('Load current questions', 'reload', 'primary');
    if (model.state === 'unconfirmed') add('Recheck', 'recheck', 'primary');
    if (model.state === 'recorded-waiting') add('Continue', 'continue', 'primary');
    if (['recorded-waiting', 'rejected', 'unconfirmed'].includes(model.state)) add('View log', 'viewLog');
    if (model.editable || model.state === 'stale') add('Discard draft', 'discard');
    add('Questions file', 'openQuestions');
    add('Later', 'later');
    if (model.editable && model.state !== 'unconfirmed') {
      const submitButton = el('button', 'Submit & continue session', 'mg-btn mg-btn--primary');
      submitButton.type = 'button';
      submitButton.id = 'submit';
      submitButton.disabled = true;
      submitButton.addEventListener('click', submit);
      bar.append(submitButton);
    }
    return bar;
  }

  function submit() {
    const count = completeness().filter(Boolean).length;
    if (canSend(count)) page.post({ type: 'submit', revision: model.revision, fingerprint: model.fingerprint });
  }

  function rerender() {
    if (!model) return;
    const active = document.activeElement;
    const focusId = active && active.id;
    const area = active && active.tagName === 'TEXTAREA' ? active : null;
    const caret = area ? [area.selectionStart, area.selectionEnd, area.selectionDirection, area.scrollTop] : null;
    const scroll = window.scrollY;
    root.replaceChildren(header());
    const status = note();
    if (status) root.append(status);
    root.append(jumps());
    for (const q of model.questions) root.append(question(q));
    if (model.archived) root.append(archivedSection());
    root.append(footer());
    updateChrome();
    if (focusId) {
      const node = document.getElementById(focusId);
      if (node) {
        node.focus({ preventScroll: true });
        if (caret && node.tagName === 'TEXTAREA') {
          node.setSelectionRange(caret[0], caret[1], caret[2]);
          node.scrollTop = caret[3];
        }
      }
    }
    window.scrollTo(0, scroll);
    // Local renders (the Other toggle) replace the footer too.
    trackFooter();
  }

  function render(next) {
    if (!next) return;
    const previous = model;
    model = next;
    // The local draft is newer than the host's echo of it, until the host replaces the draft (new generation) or
    // the batch changes (new fingerprint).
    if (previous && previous.generation === model.generation && previous.fingerprint === model.fingerprint) {
      model.draft = previous.draft;
    }
    // State, diagnostics and controls always apply; rerender keeps the focus, caret and scroll position.
    rerender();
  }

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && model && model.editable) submit();
  });

  page = connect({ render });
})();
