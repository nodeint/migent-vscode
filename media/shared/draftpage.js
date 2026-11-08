// Shared draft handling for form pages (the Workflow editor, the Session workflow page and Configuration). A page keeps
// one or more *draft units*; each holds the draft being edited, the last form adopted from disk and the three
// transitions of that pair. Whether a dirty draft survives a disk refresh is a policy the page decides, not built-in
// behavior. Also: the model-pick routing and the notices/footer refresh the pages repeat.
// Needs media/shared/page.js and form.js loaded first (see docs/ui.md). Exposes `MigentDraftPage`.
(function () {
  'use strict';

  /** Stable JSON: key order never makes two equal drafts look different. */
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value !== null && typeof value === 'object') {
      return (
        '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + stable(value[key]))
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(value);
  }

  /**
   * One draft and the form it was started from.
   *
   * normalize(form)  copy a host form into the page's draft shape
   * empty()          the form before any model arrived
   *
   * `form` is edited in place by the controls. `saved` is the normalized form of the last disk state adopted.
   */
  function createUnit(options) {
    const unit = {
      form: options.empty(),
      saved: options.empty(),
      /** Stable JSON of the draft last sent to save, so edits made during the save survive its completion. */
      submitted: null,
      isDirty: () => stable(unit.form) !== stable(unit.saved),
      /** Disk refresh or confirmed save: `keepDraft` is the page's policy; the saved side always follows the host. */
      adopt(nextForm, keepDraft) {
        if (!keepDraft) unit.form = options.normalize(nextForm);
        unit.saved = options.normalize(nextForm);
      },
      /** Explicit discard: the draft goes back to the last adopted form. */
      discard() {
        unit.form = options.normalize(unit.saved);
      },
      /** Whether the draft is still the one with this stable JSON. */
      submittedStable: (json) => stable(unit.form) === json,
      editedSinceSubmit: () => unit.submitted !== null && stable(unit.form) !== unit.submitted,
      markSubmitted() {
        unit.submitted = stable(unit.form);
      },
    };
    return unit;
  }

  /**
   * Routes one pending model pick: the page remembers which control asked, the host replies with `modelPicked`, and
   * `apply` writes the choice into the draft only when something is pending.
   */
  function createPicker(post, apply) {
    let pending = null;
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'modelPicked' || pending === null) return;
      const token = pending;
      pending = null;
      if (typeof message.client === 'string' && typeof message.model === 'string') apply(token, message);
    });
    return {
      request(token) {
        pending = token;
        post('pickModel');
      },
    };
  }

  /**
   * The notices area and the sticky footer, refreshed in place after an edit so the focused input survives.
   * options.renderNotices()  nodes of the notices area
   * options.footerOptions()  options of `MigentForm.saveFooter`
   */
  function createChrome(options) {
    let noticesHost = null;
    let footerHost = null;
    const { trackFooter } = window.MigentPage;
    const ui = window.MigentForm;
    return {
      reset() {
        noticesHost = null;
        footerHost = null;
      },
      notices() {
        noticesHost = ui.notices([]);
        noticesHost.append(...options.renderNotices());
        return noticesHost;
      },
      footer() {
        footerHost = ui.saveFooter(options.footerOptions());
        return footerHost;
      },
      /** The notices and the footer follow an edit; the form is not rebuilt. */
      refresh() {
        if (noticesHost !== null) noticesHost.replaceChildren(...options.renderNotices());
        if (footerHost !== null) {
          ui.saveFooter(options.footerOptions(), footerHost);
          trackFooter();
        }
      },
    };
  }

  window.MigentDraftPage = { stable, createUnit, createPicker, createChrome };
})();
