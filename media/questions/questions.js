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
  let pendingFocus = null;
  // True between compositionstart and compositionend (IME input such as Telex or VNI). Replacing the text area
  // in that window cancels the composition, so a model that arrives meanwhile waits until it ends.
  let isComposing = false;
  let deferred = null;
  let viewObserver = null;

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
    const bar = document.getElementById('progress-bar');
    if (bar) {
      bar.max = model.questions.length;
      bar.value = count;
    }
    model.questions.forEach((q, index) => {
      const jump = document.getElementById('jump-' + q.id);
      if (jump) {
        jump.replaceChildren(q.id, ...(done[index] ? [icon('check')] : []));
        jump.classList.toggle('q-jump--done', done[index]);
        jump.setAttribute('aria-label', 'Go to question ' + q.id + (done[index] ? ' (answered)' : ' (not answered)'));
      }
      const chip = document.getElementById('qs-' + q.id);
      if (chip) {
        chip.replaceChildren(icon(done[index] ? 'pass' : 'circle'), done[index] ? 'Answered' : 'Unanswered');
        chip.className = 'q-state mg-status mg-status--' + (done[index] ? 'ok' : 'muted');
      }
    });
    const submitButton = document.getElementById('submit');
    if (submitButton) {
      submitButton.disabled = !canSend(count);
      const left = model.questions.length - count;
      submitButton.textContent = left > 0 ? 'Submit & continue (' + left + ' left)' : 'Submit & continue session';
    }
  }

  function optionRow(q, option) {
    const d = draftOf(q.id);
    const input = el('input');
    input.type = q.selection === 'single' ? 'radio' : 'checkbox';
    input.name = 'q' + q.id;
    input.id = 'q' + q.id + option.id;
    input.checked = d.mode === 'choice' && d.selected.includes(option.id);
    input.disabled = !model.editable;
    if (option.description) input.setAttribute('aria-describedby', 'd' + q.id + option.id);
    input.addEventListener('change', (event) => {
      const was = draftOf(q.id);
      const current = was.mode === 'choice' ? was.selected : [];
      let selected;
      if (q.selection === 'single') selected = [option.id];
      else if (event.target.checked) selected = q.options.map((o) => o.id).filter((id) => id === option.id || current.includes(id));
      else selected = current.filter((id) => id !== option.id);
      edit(q.id, { mode: 'choice', selected });
      if (was.mode === 'text') rerender();
    });
    const label = el('label', null, 'q-option');
    label.htmlFor = input.id;
    const body = el('span', null, 'q-option-body');
    const head = el('span', null, 'q-option-head');
    head.append(el('span', option.label, 'q-option-label'));
    if (q.recommended.includes(option.id)) head.append(el('span', 'Recommended', 'mg-pill'));
    body.append(head);
    if (option.description) {
      const desc = el('span', option.description, 'q-option-desc mg-muted');
      desc.id = 'd' + q.id + option.id;
      body.append(desc);
    }
    label.append(input, el('span', option.id, 'q-letter'), body);
    return label;
  }

  function contextBlock(q) {
    const wrapper = el('div');
    const isLong = q.context.length > CONTEXT_CLAMP_LENGTH;
    const isOpen = expandedContext.has(q.id);
    const ctx = el('div', q.context, 'q-context' + (isLong && !isOpen ? ' q-context--clamped' : ''));
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
    other.type = q.selection === 'single' ? 'radio' : 'checkbox';
    other.name = 'q' + q.id;
    other.id = 'other' + q.id;
    other.checked = d.mode === 'text';
    other.disabled = !model.editable;
    other.addEventListener('change', (event) => {
      edit(q.id, { mode: event.target.checked ? 'text' : 'choice' });
      if (event.target.checked) pendingFocus = 'text' + q.id;
      rerender();
    });
    const label = el('label', null, 'q-option q-option--other');
    label.htmlFor = other.id;
    const body = el('span', null, 'q-option-body');
    const head = el('span', null, 'q-option-head');
    head.append(el('span', 'Other', 'q-option-label'));
    head.append(el('span', 'write your own answer', 'q-option-desc mg-muted'));
    body.append(head);
    label.append(other, el('span', '…', 'q-letter'), body);
    return label;
  }

  function question(q) {
    const d = draftOf(q.id);
    const box = el('section', null, 'q-question');
    box.id = 'card-' + q.id;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', 'qt-' + q.id);
    const top = el('div', null, 'q-top');
    top.append(el('span', 'Question ' + q.id + ' · ' + (q.selection === 'single' ? 'Choose one' : 'Choose one or more'), 'q-eyebrow'));
    const state = el('span', null, 'q-state mg-status mg-status--muted');
    state.id = 'qs-' + q.id;
    top.append(state);
    const title = el('h2', q.question, 'q-title');
    title.id = 'qt-' + q.id;
    box.append(top, title);
    if (q.context) box.append(contextBlock(q));
    const options = el('div', null, 'q-options');
    for (const option of q.options) options.append(optionRow(q, option));
    options.append(otherRow(q, d));
    box.append(options);
    if (d.mode === 'text') {
      const area = el('textarea', null, 'mg-input q-text');
      area.id = 'text' + q.id;
      area.placeholder = 'Write your answer';
      area.setAttribute('aria-label', 'Your answer to question ' + q.id);
      area.disabled = !model.editable;
      area.value = d.text;
      area.addEventListener('input', (event) => edit(q.id, { text: event.target.value }));
      area.addEventListener('compositionstart', () => {
        isComposing = true;
      });
      area.addEventListener('compositionend', () => {
        isComposing = false;
        // The last input event of a composition can follow compositionend, so apply the waiting model afterwards.
        setTimeout(() => {
          if (isComposing || deferred === null) return;
          const waiting = deferred;
          deferred = null;
          render(waiting);
        }, 0);
      });
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
    const bar = el('progress', null, 'q-bar');
    bar.id = 'progress-bar';
    bar.setAttribute('aria-hidden', 'true');
    chip.append(icon('checklist'), count, bar);
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
    const chips = el('span', null, 'q-chips');
    for (const q of model.questions) {
      const jump = el('button', q.id, 'q-jump');
      jump.type = 'button';
      jump.id = 'jump-' + q.id;
      jump.title = q.question;
      jump.addEventListener('click', () => document.getElementById('card-' + q.id).scrollIntoView());
      chips.append(jump);
    }
    nav.append(chips, progressChip());
    return nav;
  }

  // Marks the chip of the question in view. Skipped where IntersectionObserver is missing.
  function watchView() {
    if (viewObserver) viewObserver.disconnect();
    viewObserver = null;
    if (typeof IntersectionObserver === 'undefined') return;
    viewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const q of model.questions) {
          const jump = document.getElementById('jump-' + q.id);
          if (jump) {
            if ('card-' + q.id === entry.target.id) jump.setAttribute('aria-current', 'true');
            else jump.removeAttribute('aria-current');
          }
        }
      }
    }, { rootMargin: '-20% 0px -60% 0px' });
    for (const q of model.questions) {
      const card = document.getElementById('card-' + q.id);
      if (card) viewObserver.observe(card);
    }
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
    watchView();
    const wanted = pendingFocus || focusId;
    pendingFocus = null;
    if (wanted) {
      const node = document.getElementById(wanted);
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

  // What the page draws, without what the local draft already decides: revision, validation of the draft and the
  // submit flag. A model that differs only there is the host echoing an edit, and nothing needs redrawing.
  const DRAFT_DERIVED = ['revision', 'draft', 'issues', 'answered', 'canSubmit'];

  function drawnSignature(value) {
    return JSON.stringify(value, (key, item) => (DRAFT_DERIVED.includes(key) ? undefined : item));
  }

  function render(next) {
    if (!next) return;
    if (isComposing) {
      deferred = next;
      return;
    }
    const previous = model;
    model = next;
    // The local draft is newer than the host's echo of it, until the host replaces the draft (new generation) or
    // the batch changes (new fingerprint).
    const isSameBatch = previous && previous.generation === model.generation && previous.fingerprint === model.fingerprint;
    if (isSameBatch) model.draft = previous.draft;
    // An echo of an edit keeps the DOM, so typing never replaces the control being typed in.
    if (isSameBatch && drawnSignature(previous) === drawnSignature(model)) {
      updateChrome();
      return;
    }
    // State, diagnostics and controls otherwise apply; rerender keeps the focus, caret and scroll position.
    rerender();
  }

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && model && model.editable) submit();
  });

  page = connect({ render });
})();
