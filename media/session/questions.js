// Questions tab of the Session page. All content is rendered with textContent; the host validates every message
// again. The shared helpers in media/shared load first (see docs/ui.md).
(function () {
  'use strict';

  const { trackFooter } = window.MigentPage;
  const copy = window.MigentCopy;
  const ui = window.MigentUi;
  const { el, details, icon } = ui;
  const text = window.MigentSessionQuestionsCopy;
  const CONTEXT_CLAMP_LENGTH = 240;
  // The tone of the banner for the batch's state. Anything else is plain information.
  const BANNER_TONES = {
    recorded: 'ok',
    continuing: 'ok',
    rejected: 'error',
    unavailable: 'error',
    unconfirmed: 'warn',
    stale: 'warn',
    'answered-elsewhere': 'warn',
    'recorded-waiting': 'warn',
  };
  // The status chip of a question card: icon, tone and text.
  const CARD_STATES = {
    recorded: { icon: 'pass', tone: 'ok', text: text.state.sent },
    answered: { icon: 'pass', tone: 'ok', text: text.state.answered },
    open: { icon: 'circle', tone: 'muted', text: text.state.notAnswered },
  };
  let model = null;
  // The session's attempts and the selected one, for the attempt selector: `{ attempts, selected }`.
  let nav = { attempts: [], selected: null };
  // Context blocks the reader expanded; kept across re-renders.
  const expandedContext = new Set();
  let page = null;
  let mount = null;
  let pendingFocus = null;
  // True between compositionstart and compositionend (IME input such as Telex or VNI). Replacing the text area
  // in that window cancels the composition, so a model that arrives meanwhile waits until it ends.
  let isComposing = false;
  let deferred = null;
  let isDeferredNavChanged = false;
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

  // Live completeness only; the host revalidates and decides whether Send is allowed.
  function completeness() {
    return model.questions.map((q) => {
      const d = draftOf(q.id);
      return d.mode === 'text' ? d.text.trim().length > 0 : d.selected.length > 0;
    });
  }

  function canSend(count) {
    return model.canSubmit && count === model.questions.length;
  }

  function cardState(q, isDone) {
    if (isRecordedCard(q)) return CARD_STATES.recorded;
    return isDone ? CARD_STATES.answered : CARD_STATES.open;
  }

  // The kit status badge, refilled in place so the card around it is not redrawn on every keystroke.
  function paintState(node, state) {
    node.className = 'mg-status mg-status--' + state.tone;
    node.replaceChildren(icon(state.icon), el('span', state.text));
  }

  function updateChrome() {
    const drafted = completeness();
    const count = drafted.filter(Boolean).length;
    model.questions.forEach((q, index) => {
      const isDone = isRecordedCard(q) || drafted[index];
      const jump = document.getElementById('jump-' + q.id);
      if (jump) {
        jump.replaceChildren(q.id, ...(isDone ? [icon('check')] : []));
        jump.classList.toggle('q-jump--done', isDone);
        jump.setAttribute('aria-label', text.jumps.goTo(q.id, isDone));
      }
      const chip = document.getElementById('qs-' + q.id);
      if (chip) paintState(chip, cardState(q, isDone));
    });
    const submitButton = document.getElementById('submit');
    if (submitButton && model.state !== 'sending') {
      submitButton.disabled = !canSend(count);
      const left = model.questions.length - count;
      submitButton.textContent = left > 0 ? text.footer.sendLeft(left) : text.footer.send;
    }
  }

  // Once the answers are recorded the card is a read-only record: the question and what was recorded.
  function isRecordedCard(q) {
    return !model.editable && Boolean(model.recorded) && model.recorded[q.id] !== undefined;
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
    if (q.recommended.includes(option.id)) head.append(ui.pill(text.question.recommended));
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
      const toggle = ui.button(isOpen ? text.question.showLess : text.question.showMore, {
        kind: 'link',
        onClick: () => {
          if (expandedContext.has(q.id)) expandedContext.delete(q.id);
          else expandedContext.add(q.id);
          const open = expandedContext.has(q.id);
          ctx.classList.toggle('q-context--clamped', !open);
          toggle.textContent = open ? text.question.showLess : text.question.showMore;
          toggle.setAttribute('aria-expanded', String(open));
        },
      });
      toggle.id = 'ctxbtn-' + q.id;
      toggle.setAttribute('aria-controls', ctx.id);
      toggle.setAttribute('aria-expanded', String(isOpen));
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
    head.append(el('span', text.question.other, 'q-option-label'));
    head.append(el('span', text.question.otherHint, 'q-option-desc mg-muted'));
    body.append(head);
    label.append(other, el('span', '…', 'q-letter'), body);
    return label;
  }

  // What was recorded for a question, as one kit key-value row.
  function recordedRow(answer) {
    return ui.keyValues([{ label: text.question.recorded, value: answer, tone: 'ok' }], { dense: true });
  }

  // A question is a kit card section: the question as its title, the selection mode as its note and the answer
  // state as its action; the body holds the context, the options and what was recorded.
  function question(q) {
    const d = draftOf(q.id);
    const state = ui.statusIndicator(CARD_STATES.open);
    state.id = 'qs-' + q.id;
    const box = ui.section(q.question, {
      variant: 'card',
      note: text.question.eyebrow(q.id, model.questions.length, q.selection === 'single'),
      actions: [state],
    });
    box.className += ' q-card';
    box.id = 'card-' + q.id;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', 'qt-' + q.id);
    box.querySelector('.mg-section-title').id = 'qt-' + q.id;
    const body = box.querySelector('.mg-section-body');
    if (isRecordedCard(q)) {
      body.append(recordedRow(model.recorded[q.id]));
      return box;
    }
    if (q.context) body.append(contextBlock(q));
    const options = el('div', null, 'q-options');
    for (const option of q.options) options.append(optionRow(q, option));
    options.append(otherRow(q, d));
    body.append(options);
    if (d.mode === 'text') {
      const area = el('textarea', null, 'mg-input q-text');
      area.id = 'text' + q.id;
      area.placeholder = text.question.placeholder;
      area.setAttribute('aria-label', text.question.answerLabel(q.id));
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
          const isWaitingNavChanged = isDeferredNavChanged;
          deferred = null;
          isDeferredNavChanged = false;
          applyModel(waiting, isWaitingNavChanged);
        }, 0);
      });
      body.append(area);
      if (model.ambiguous.includes(q.id)) {
        body.append(ui.alertLine(text.question.ambiguous, { tone: 'warn', role: 'status' }));
      }
    }
    if (model.recorded && model.recorded[q.id] !== undefined) body.append(recordedRow(model.recorded[q.id]));
    return box;
  }

  // The state message and block reason, as one banner whose tone follows the batch state. Sending has its own sign
  // of life on the button, so it gets no banner.
  function note() {
    if (model.state === 'sending' || (!model.message && !model.blockReason)) return null;
    const tone = BANNER_TONES[model.state] || 'info';
    const lines = [];
    if (model.message) lines.push(model.message);
    if (model.blockReason && (model.editable || !model.message)) {
      lines.push({ text: model.blockReason, className: model.message ? 'mg-muted' : '' });
    }
    return ui.banner({ tone, lines });
  }

  // One jump chip per question of the shown attempt: the number, then a check once answered.
  function jumps() {
    const strip = el('nav', null, 'q-jumps');
    strip.setAttribute('aria-label', text.jumps.label);
    for (const q of model.questions) {
      const jump = el('button', q.id, 'q-jump');
      jump.type = 'button';
      jump.id = 'jump-' + q.id;
      jump.title = q.question;
      jump.addEventListener('click', () => document.getElementById('card-' + q.id).scrollIntoView());
      strip.append(jump);
    }
    return strip;
  }

  const refKey = (ref) => (ref.stageId || '') + '/' + ref.executionId;

  function attemptLabel(attempt) {
    const stage = attempt.stageId === null ? text.attempts.roleSession : attempt.stageId;
    return text.attempts.option(stage, attempt.attempt);
  }

  // The attempt selector: every attempt that asked questions, the selected one shown. Picking another asks the
  // host for it; the host answers with that attempt's model.
  function attemptSelect() {
    const attempts = nav.attempts;
    const control = ui.select({
      value: nav.selected === null ? '' : refKey(nav.selected),
      options: attempts.map((attempt) => ({ value: refKey(attempt), label: attemptLabel(attempt) })),
      onInput: (value) => {
        const picked = attempts.find((attempt) => refKey(attempt) === value);
        if (picked) page.send({ intent: 'selectBatch', batch: { stageId: picked.stageId, executionId: picked.executionId } });
      },
    });
    control.id = 'attempt-select';
    control.setAttribute('aria-label', text.attempts.label);
    return control;
  }

  // The sticky bar above the questions: the attempt on the left, the jump chips on the right.
  function toolbar() {
    const bar = el('div', null, 'q-toolbar');
    const pick = el('div', null, 'q-toolbar-attempt');
    pick.append(attemptSelect());
    bar.append(pick, jumps());
    return bar;
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
    const box = details(text.archived.title, { key: 'archived' });
    box.querySelector('summary').id = 'archived-summary';
    box.append(ui.plainList(model.archived.map((item) => text.archived.line(item.id, item.question, item.answer))));
    return box;
  }

  function footer() {
    const buttons = [];
    const add = (label, type, kind) => {
      const node = ui.button(label, { kind: kind || 'secondary', size: 'md', onClick: () => page.post({ type }) });
      node.id = 'act-' + type;
      buttons.push(node);
    };
    if (model.state === 'stale') add(text.footer.reload, 'reload', 'primary');
    if (model.state === 'unconfirmed') add(text.footer.recheck, 'recheck', 'primary');
    if (model.state === 'recorded-waiting') add(text.footer.continue, 'continue', 'primary');
    if (['recorded-waiting', 'rejected', 'unconfirmed'].includes(model.state)) add(copy.menu.viewLog, 'viewLog');
    if (model.editable || model.state === 'stale') add(text.footer.discard, 'discard');
    if (model.editable && model.state !== 'unconfirmed') {
      const submitButton = ui.button(text.footer.send, { kind: 'primary', size: 'md', disabled: true, onClick: submit });
      submitButton.id = 'submit';
      buttons.push(submitButton);
    }
    if (model.state === 'sending') {
      // The send is in flight: the button stays where it was and says so, until the state moves on.
      const sending = ui.button('', { kind: 'primary', size: 'md', disabled: true });
      sending.id = 'submit';
      sending.setAttribute('aria-busy', 'true');
      sending.replaceChildren(icon('sync', true), ' ' + text.footer.sending);
      buttons.push(sending);
    }
    return buttons.length > 0 ? ui.footer({ children: buttons }) : null;
  }

  function submit() {
    const count = completeness().filter(Boolean).length;
    if (canSend(count)) page.post({ type: 'submit', revision: model.revision, fingerprint: model.fingerprint });
  }

  function rerender() {
    if (!model || mount === null) return;
    const active = document.activeElement;
    const focusId = active && active.id;
    const area = active && active.tagName === 'TEXTAREA' ? active : null;
    const caret = area ? [area.selectionStart, area.selectionEnd, area.selectionDirection, area.scrollTop] : null;
    const scroll = window.scrollY;
    mount.replaceChildren(toolbar());
    const status = note();
    if (status) mount.append(status);
    const cards = model.questions.map(question);
    if (cards.length > 0) mount.append(ui.stack(cards, { gap: 'card' }));
    if (model.archived) mount.append(archivedSection());
    const actions = footer();
    if (actions) mount.append(actions);
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

  function applyModel(next, isNavChanged) {
    if (!next) return;
    if (isComposing) {
      deferred = next;
      isDeferredNavChanged = isDeferredNavChanged || Boolean(isNavChanged);
      return;
    }
    const previous = model;
    model = next;
    // The local draft is newer than the host's echo of it, until the host replaces the draft (new generation) or
    // the batch changes (new fingerprint).
    const isSameBatch = previous && previous.generation === model.generation && previous.fingerprint === model.fingerprint;
    if (isSameBatch) model.draft = previous.draft;
    // An echo of an edit keeps the DOM, so typing never replaces the control being typed in.
    if (isSameBatch && !isNavChanged && drawnSignature(previous) === drawnSignature(model)) {
      updateChrome();
      return;
    }
    // State, diagnostics and controls otherwise apply; rerender keeps the focus, caret and scroll position.
    rerender();
  }

  // `attempts` is `{ attempts, selected }` from the Questions tab model, for the attempt selector.
  function render(container, next, host, attempts) {
    page = host;
    const isNewMount = container !== mount;
    mount = container;
    const nextNav = attempts || { attempts: [], selected: null };
    const isNavChanged = JSON.stringify(nextNav) !== JSON.stringify(nav);
    nav = nextNav;
    if (isNewMount) {
      model = next;
      rerender();
      return;
    }
    applyModel(next, isNavChanged);
  }

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && model && model.editable) submit();
  });

  // Forget the shown batch, for a session that has none left to show.
  function reset() {
    model = null;
    mount = null;
  }

  window.MigentSessionQuestions = { render, reset };
})();
