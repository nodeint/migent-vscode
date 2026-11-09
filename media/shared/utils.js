// Shared pure helpers for Migent webview pages: small functions that more than one script needs and that touch no DOM.
// Loaded first, before `copy.js` (see docs/ui.md), so the copy files can build their texts with it. Exposes one global,
// `MigentUtils`.
(function () {
  'use strict';

  /** A count with its noun, `plural(2, 'stage')` is "2 stages" and `plural(1, 'stage')` is "1 stage". */
  const plural = (count, noun) => count + ' ' + noun + (count === 1 ? '' : 's');

  window.MigentUtils = { plural };
})();
