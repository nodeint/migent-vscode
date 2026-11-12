// The one Session page: a single header and the body of the tab the host last posted. Overview, Metrics, Workflow
// and Questions each keep their own renderer in this folder; the shell only draws the shared header and the tab
// switch. The shared UI kit and host adapter in media/shared load first (see docs/ui.md).
(function () {
  'use strict';

  const { connect, trackFooter } = window.MigentPage;
  const { el } = window.MigentUi;
  const { sessionHeader } = window.MigentSessionHeader;
  const copy = window.MigentCopy;
  const text = window.MigentSessionCopy;
  const root = document.getElementById('root');

  function selectTab(tab) {
    return () => page.send({ intent: 'selectTab', tab });
  }

  function sessionAction(name) {
    return { intent: 'sessionAction', action: name };
  }

  function menuFor(model) {
    switch (model.tab) {
      case 'overview':
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
    // Questions is always there; its badge counts the questions still waiting for an answer.
    const waiting = data.meta.pendingQuestions;
    const tabs = [
      { key: 'overview', label: copy.tab.overview, onSelect: selectTab('overview') },
      {
        key: 'questions',
        label: copy.tab.questions,
        onSelect: selectTab('questions'),
        // Nothing to show until the session asks a question.
        disabled: data.hasQuestions === false,
        title: data.hasQuestions === false ? text.noQuestions : undefined,
        badge: waiting > 0 ? waiting : null,
        badgeLabel: waiting > 0 ? text.questionsTab(waiting) : null,
      },
      { key: 'metrics', label: copy.tab.metrics, onSelect: selectTab('metrics') },
      { key: 'workflow', label: copy.tab.workflow, onSelect: selectTab('workflow') },
      { key: 'task', label: copy.tab.task, onSelect: () => page.send(sessionAction('openTask')) },
    ];
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
  const questionsMount = el('div');
  root.append(headerHost, bodyHost);
  let isQuestionsBody = false;

  function renderQuestions(model) {
    if (!isQuestionsBody) {
      bodyHost.replaceChildren(questionsMount);
      isQuestionsBody = true;
    }
    const { model: answers, attempts, selected } = model.questions;
    if (answers === null) {
      window.MigentSessionQuestions.reset();
      questionsMount.replaceChildren(window.MigentUi.empty(text.noQuestions, { icon: 'comment-discussion' }));
      return;
    }
    window.MigentSessionQuestions.render(questionsMount, answers, page, { attempts, selected });
  }

  function renderOther(model, transient) {
    const container = el('div');
    isQuestionsBody = false;
    bodyHost.replaceChildren(container);
    switch (model.tab) {
      case 'overview':
        window.MigentSessionOverview.render(container, model.overview, page);
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
