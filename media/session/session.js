// The one Session page: a single header and the body of the tab the host last posted. Results, Metrics, Workflow
// and Questions each keep their own renderer in this folder; the shell only draws the shared header, the batch
// selector and the tab switch. The shared helpers in media/shared/page.js load first (see docs/ui.md).
(function () {
  'use strict';

  const { el, connect, sessionHeader, trackFooter } = window.MigentPage;
  const copy = window.MigentCopy;
  const text = window.MigentSessionCopy;
  const root = document.getElementById('root');

  // Once the reader has seen Questions, its tab stays until the panel closes, also after the answers are recorded.
  let questionsVisible = false;

  function selectTab(tab) {
    return () => page.send({ intent: 'selectTab', tab });
  }

  function sessionAction(name) {
    return { intent: 'sessionAction', action: name };
  }

  function menuFor(model) {
    switch (model.tab) {
      case 'results':
        return [{ label: text.menu.openQuestions, onSelect: () => page.send(sessionAction('openQuestions')) }];
      case 'metrics':
        return [{ label: text.menu.openMetricsFile, onSelect: () => page.send({ intent: 'openMetricsFile' }) }];
      case 'workflow':
        return [
          { label: text.menu.openWorkflowFile, onSelect: () => page.post({ type: 'openFile' }) },
          { label: copy.menu.reloadFromDisk, onSelect: () => page.post({ type: 'reload' }) },
        ];
      default:
        return [];
    }
  }

  function header(model) {
    const { header: data } = model;
    if (data.meta.pendingQuestions > 0 || model.tab === 'questions') questionsVisible = true;
    const tabs = [];
    if (questionsVisible) tabs.push({ key: 'questions', label: copy.tab.questions, onSelect: selectTab('questions') });
    tabs.push(
      { key: 'results', label: copy.tab.results, onSelect: selectTab('results') },
      { key: 'metrics', label: copy.tab.metrics, onSelect: selectTab('metrics') },
      { key: 'workflow', label: copy.tab.workflow, onSelect: selectTab('workflow') },
      { key: 'task', label: copy.tab.task, onSelect: () => page.send(sessionAction('openTask')) },
    );
    return sessionHeader(page, {
      state: data.state,
      title: data.title,
      workflowId: data.workflowId,
      meta: data.meta,
      current: model.tab,
      tabs,
      menuItems: menuFor(model),
    });
  }

  function sameBatch(batch, selected) {
    return selected !== null && selected.executionId === batch.executionId && selected.stageId === batch.stageId;
  }

  /** The chip row that picks one pending batch, shown only when the session has more than one. */
  function batchSelector(questions) {
    if (questions.batches.length < 2) return null;
    const nav = el('nav', null, 'q-batches');
    nav.setAttribute('aria-label', text.batches.label);
    for (const batch of questions.batches) {
      const isCurrent = sameBatch(batch, questions.selected);
      const label = text.batches.chip(batch.stageId === null ? text.batches.roleSession : batch.stageId, batch.count);
      const button = el('button', label, 'q-batch' + (isCurrent ? ' q-batch--current' : ''));
      button.type = 'button';
      button.title = batch.executionId;
      if (isCurrent) {
        button.setAttribute('aria-current', 'true');
      } else {
        button.addEventListener('click', () =>
          page.send({ intent: 'selectBatch', batch: { stageId: batch.stageId, executionId: batch.executionId } }),
        );
      }
      nav.append(button);
    }
    return nav;
  }

  function unavailable(sessionId) {
    const body = el('div');
    body.append(
      el('h1', copy.sessionUnavailable.title, 'mg-title'),
      el('p', copy.sessionUnavailable.body(sessionId), 'mg-subtitle'),
    );
    return body;
  }

  // The header and the body have their own hosts, so a render never detaches the part that did not change. The
  // Questions tab keeps one mount for as long as the page lives: a background update then reaches the form in place
  // and keeps the local draft, the focus and the caret instead of rebuilding the controls under the reader.
  const headerHost = el('div');
  const bodyHost = el('div');
  const selectorHost = el('div');
  const questionsMount = el('div');
  root.append(headerHost, bodyHost);
  let isQuestionsBody = false;

  function renderQuestions(model) {
    if (!isQuestionsBody) {
      bodyHost.replaceChildren(selectorHost, questionsMount);
      isQuestionsBody = true;
    }
    const selector = batchSelector(model.questions);
    selectorHost.replaceChildren(...(selector ? [selector] : []));
    if (model.questions.model === null) {
      window.MigentSessionQuestions.reset();
      questionsMount.replaceChildren(el('p', text.noQuestions, 'mg-muted'));
      return;
    }
    window.MigentSessionQuestions.render(questionsMount, model.questions.model, page);
  }

  function renderOther(model, transient) {
    const container = el('div');
    isQuestionsBody = false;
    bodyHost.replaceChildren(container);
    switch (model.tab) {
      case 'results':
        window.MigentSessionResults.render(container, model.results, page);
        break;
      case 'metrics':
        window.MigentSessionMetrics.render(container, model.metrics, page);
        break;
      case 'workflow':
        window.MigentSessionWorkflow.render(container, model.workflow, transient, page);
        break;
    }
  }

  function renderBody(model, transient) {
    if (model.header.availability === 'unavailable') {
      isQuestionsBody = false;
      bodyHost.replaceChildren(unavailable(model.header.sessionId));
    } else if (model.tab === 'questions') {
      renderQuestions(model);
    } else {
      renderOther(model, transient);
    }
  }

  function render(model, transient) {
    headerHost.replaceChildren(header(model));
    renderBody(model, transient);
    document.title = model.header.title;
    trackFooter();
  }

  const page = connect({ render });
})();
