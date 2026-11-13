# Webview UI

This page defines how Migent webview pages are built: the shared page foundation, the design vocabulary and the
rules every page keeps. Every page (Session, the Workflow editor and Configuration) is on the foundation.
For module ownership see [Architecture](architecture.md); for how to verify UI changes see [Testing](testing.md).

## Page architecture

A page is a webview panel whose HTML, styles and script come from `media/`. Three layers own it:

| Layer | Location | Owns |
| :--- | :--- | :--- |
| Host helper | [page.ts](../src/vscode/webview/page.ts), [pageHtml.ts](../src/vscode/webview/pageHtml.ts) | The HTML skeleton, the content security policy, the nonce, asset order and `localResourceRoots` |
| Shared assets | [media/shared](../media/shared) | Tokens and component styles (`base.css`, including the save footer, notices and collapsible card), pure helpers (`utils.js`), icons (`icons.js`), shared copy (`copy.js`), the UI kit (`dom.js`, `components.js`, `form.js`) and the host adapter (`page.js`, `draftpage.js`) |
| Page assets | `media/<page>/` | Layout and rendering of one page; no tokens or component styles of its own |

A page is described by a `PageDescriptor`: its `media/` folder, its own stylesheet and script names and its title.
The helper never takes HTML fragments or user data, so a page cannot weaken the policy.

- **Policy.** `default-src 'none'; style-src <cspSource>; script-src 'nonce-<nonce>'`. A fresh nonce is generated for
  every render and set on every script. No inline script or style, no remote resource.
- **Order.** The shared stylesheet loads before the page stylesheet, and the shared scripts (`utils.js`, `icons.js`,
  `copy.js`, the kit `dom.js`, `components.js` and `form.js`, then `page.js`, `agentform.js` and `draftpage.js`) before
  the page script. The page script depends on the globals `MigentIcons`, `MigentCopy`, `MigentUi`, `MigentPage`,
  `MigentAgentForm` and `MigentDraftPage` that they define.
- **Roots.** `localResourceRoots` is derived from the same descriptor and allows `media/shared` and the page's own
  folder only. Both folders are already packaged (`!media/**` in `.vscodeignore`); no build step is involved.
- **Model.** The host posts `{ type: 'model', revision, identity, model }`, plus an optional `transient`, only when
  the model changed and answers the page's `ready` message with the current one. The page ignores a revision it
  has already shown and records `identity` with `setState` so a serializer can restore the panel.
- **Intents.** Unless a page documents its own message set (see Questions below), the page sends
  `{ type: 'intent', intent, ... }` with identity only: a key, a name, a session id or a
  member of a closed action set.
  resolves any path or command itself. A page never sends a path, a command id or argv.
- **Text.** Every string is set with `textContent`. Never use `innerHTML` or `insertAdjacentHTML`. Long text is
  shortened by CSS only; the full text stays in the DOM and in a `title` tooltip set as a property.

## Shared copy

`media/shared/copy.js` defines `MigentCopy`: the text that more than one page shows, so one wording is changed in one
place. It holds the session page tabs and the more menu (`copy.tab`, `copy.menu`), the file-state suffixes
(`copy.file`), the unavailable-session message, `Unsaved changes`, `Details`, the issue banner summaries
(`copy.issues`), the defaults of the UI kit (`copy.kit`: the save, saving and discard labels, `(none)`,
`(not in list)`), `Loading the workflow…` and the name of a remove button (`copy.remove(item, number)`).

- Put a string in `copy.js` when a second page needs it; a string only one page shows stays in that page's file.
- Group by meaning, not by page (`copy.menu.reloadFromDisk`, not `copy.workflowEditor.reload`). Text with a value in
  it is a function (`copy.remove('stage', 2)`), never a concatenation at the call site.
- A string a test asserts is read from `MigentCopy` too, so a wording change does not break a test.
- Boundary: text the extension host writes (including messages it puts into a page model, such as an answer state
  message) lives in the host catalog `src/text/`; text a page writes itself lives in `media/`.

`media/workfloweditor/workflowCopy.js` defines `MigentWorkflowCopy`: every label, hint, placeholder, note and message of
the workflow form (`workflowForm.js` reads it as `text`), grouped by what the text is about (`basics`, `stages`,
`identity`, `inlineAgent`, `dependencies`, `decisions`, `advanced`, `artifacts`, `downstream`). It loads before
`workflowForm.js`, on both places that use the form (the workflow editor and the Session page's Workflow tab).
A test checks that every key the form reads exists. Text the form shares with other pages stays in `MigentCopy`.

`media/shared/utils.js` defines `MigentUtils`: pure helpers more than one script needs, such as
`plural(count, noun)`. It loads first, so the copy files can use it.

The Session page keeps one copy file per part, in `media/session/`, each loaded before the script that reads it as
`text`: `sessionCopy.js` (`MigentSessionCopy`, the shell: menu items and batch selector), `overviewCopy.js`
(`MigentSessionOverviewCopy`, the Status block, Progress, Latest activity and Overview action labels),
`resultsCopy.js` (`MigentSessionResultsCopy`, the results blocks the Overview tab draws), `metricsCopy.js`
(`MigentSessionMetricsCopy`), `sessionWorkflowCopy.js`
(`MigentSessionWorkflowCopy`, the notices around the form) and `questionsCopy.js` (`MigentSessionQuestionsCopy`).
A test checks that every key a script reads exists in its copy file.

## Shared modules

The shared scripts are plain scripts, not ES modules: a module import carries no nonce, and the files in `media/`
are the files that load. They fall into two groups with a one-way dependency: the **kit** knows no host, and the
**host adapter** uses the kit.

```text
utils.js, icons.js, copy.js        data and pure functions, no DOM
        |
KIT (no host)                      dom.js, components.js, form.js    -> one global, MigentUi
        |  (the adapter uses the kit; the kit never uses the adapter)
HOST ADAPTER                       page.js, draftpage.js
        |
agentform.js                       Migent agent editor, built on the kit
media/<page>/*.js                  data, validation, repaint and copy of one page
```

- **Kit.** `dom.js`, `components.js` and `form.js` call neither `acquireVsCodeApi` nor `postMessage`, listen for no
  `message` event and read no model. A builder takes data through its parameters and returns a node; every
  interaction leaves through a callback the caller passes (`onClick`, `onInput`, `onPick`, `onSelect`, `resolve`),
  and the kit does not know whether that callback sends a message. What an issue points at, or whether a draft is
  kept, is the page's decision, passed in as a callback or policy.
- **Host adapter.** `page.js` and `draftpage.js` are the only shared scripts that touch the VS Code API or the
  `message` event. `connect` owns the API handle and the revision guard; `createPicker` listens for `modelPicked`
  and calls the `post` function it is given.
- **Calling convention.** A builder takes at most one positional parameter, its main content (a label or a title);
  everything else is one options object. The option names are shared: `path`, `disabled`, `tone`, `kind`, `size`,
  `onClick`, `children`, `actions`, `tip`, `title` and `role`.
- **`tone` and `role`.** `tone` (`ok`, `warn`, `error`, `info`, `muted`) is presentation only: it picks the class and
  the default icon. Whether a message is announced is the separate `role` option (`alert`, `status` or `none`). A
  `banner` defaults to `alert` for an error and `status` otherwise; an `alertLine` defaults to no role. A page that
  needs another role passes it.
- **`tip` and `title`.** `tip` writes `data-tip`, the shared tooltip; `title` writes the native `title` attribute.
  Both are valid. `title` stays where it is used on purpose (a page tab, a clamped header title, a header fact, a
  checkbox row, a clickable row that holds long text); everything else uses `tip`.
- **Text.** Every string is set with `textContent`. The kit holds no display string of its own: its defaults are in
  `MigentCopy.kit`, and a page passes its own label when it has one (such as `saveLabel`).

### dom.js

| Member | Use |
| :--- | :--- |
| `el(tag, text, className)` | Create an element; `text` goes in with `textContent` |
| `icon(name, spin)` | A 16x16 codicon in the current text color. An unknown id draws nothing but keeps the box |
| `controlOf(root, path)` | The `[data-path]` control a form path edits inside `root`, or the nearest one around it (the path loses its last part until one matches). It never falls back to the first part, so a path with no control (`roles.reviewer`) finds nothing. The form decides which controls exist; the page maps its own path first |
| `revealControl(node)` | Opens the cards around a control, scrolls it to the middle of the view and focuses it |
| `openAround(node)` | Opens every `details` around a control, so a control inside a closed card can be focused or scrolled to. A control in a card's own header leaves that card closed. A page calls it before it focuses the control a repaint names |
| Tooltip (`data-tip`) | An element with a `data-tip` attribute shows one shared tooltip on hover and on keyboard focus (Escape, scroll or a click hides it). The native `title` tooltip does not reliably show in a webview, so a hint, a `button` with `tip` and an icon-only remove button use `data-tip`. The tooltip is fixed to the viewport, so a card's `overflow: clip` cannot cut it off |

### components.js

| Member | Use |
| :--- | :--- |
| `button(label, { kind, size, onClick, disabled, tip, title, className })` | A button in a kit style. `kind` is `primary`, `secondary`, `quiet`, `link` or `danger`; `size` is `sm` (24px) or `md` (28px), and a quiet or danger button is compact unless `size` says otherwise |
| `addButton(label, { onClick, disabled })`, `removeButton(label, { onClick, disabled })`, `iconButton(label, { icon, onClick, disabled, path })` | A compact add action with a plus icon, a trash-icon remove action and a quiet icon-only action such as move up or down. An icon button shows no text, so it names its row in `aria-label` and `data-tip`; `path` is a `data-path`, so a repaint can focus it |
| `addBlockButton(label, { onClick, disabled, empty })` | The add action of a whole section list. With `empty` (the message for an empty list) the block becomes one dashed frame holding the message and, under it, the button |
| `banner({ tone, icon, lines, children, actions, role })` | The one source of every `mg-banner`. The first line is the message and the rest are quieter. `role` is `alert`, `status` or `none`; the default follows the tone |
| `issueBanner({ tone, summary, issues, resolve })` | A banner with a summary and an issue list. The page's `resolve(issue)` returns `{ text, activate }` (a link that calls `activate`) or `{ text }` (plain text), so the kit reads no DOM and knows no path |
| `alertLine(message, { tone, role })` | One `mg-alert` line; `tone` is `error` or `warn`, `role` as for `banner` (none by default) |
| `notices(children)` | The `mg-notices` area under the page header that holds banners and `mg-issue-list` lists |
| `chip(label, { tone })`, `pill(label)` | A short quiet value (`mg-chip`, `tone` `info`, `warn` or `error`) and a badge-colored label (`mg-pill`) |
| `empty(message, { action, icon })` | An `mg-empty` block that states what is missing; with `action` (a node) one dashed frame holds the message and the action, and `icon` puts a codicon above it |
| `statusIndicator({ icon, tone, text, spin, compact })` | The status badge: an icon, a text and a tone. `compact` hides the text visually but keeps it for assistive technology and in the tooltip, so the icon alone is never the only signal |
| `listRow({ main, meta, onClick, title, mainClass, metaClass })` | The `li` of an `mg-list`: `main` on the left and `meta` on the right, each a string or a list of nodes. With `onClick` the row is a button |
| `denseList(items)`, `plainList(items, { mono })` | A dense list (`ul.mg-list`) of rows, strings or `{ text, className }` specs, separated by the kit divider; or a list of lines without dividers (`ul.mg-list--plain`), with `mono` for commands and activity |
| `stack(children, { gap })` | One rhythm between blocks: `gap: 'card'` between item cards (`mg-card-stack`), the default `'block'` between blocks of a body (`mg-block-stack`) |
| `actions(children)` | One flex row of buttons or other controls (`mg-actions`) |
| `refValue(value, { kind })` | A reference value (an id, a hash or a path): mono, cut at the end by CSS for `id` and `hash` in a box the layout can size, so it truncates inside a card line and inside a key-value cell, and wrapped for `path`, with the full value in the DOM and in `data-tip`. `refValue.copyButton(label, onCopy)` is its copy tool, a separate icon button so it can stay outside a link |
| `keyValues(pairs, { dense })` | A key-value grid (`dl.mg-kv`). Each pair is `{ label, value, tone?, mono?, tools? }`; `value` is a string or a node and `tools` are nodes at the end of the row |
| `details(summary, { key, className, open, path, facts, ruled })` | The shared collapsible: a `<details>` whose open state survives a model re-render, keyed by `key` and held in memory only. It draws the chevron in `.mg-details-arrow` and puts `summary` (a string or a node) in `.mg-details-heading`; `facts` are quiet strings shown beside a string title, `ruled` adds a top rule and the block gap. It starts closed unless `open` is true and the reader has not toggled it. `path` is a `data-path` on the summary |
| `itemCard({ title, number or leading, summary, meta, status, alerts, tools, actions, tone, affordance, onClick, body, titleLines, key, path, open, describe })` | One bordered item card with three modes, one look each. **Static row** (no `onClick`, no `body`) is a plain fact: the card surface, no head band, no hover, the default cursor, no control and no chevron; its `status` sits at the leading edge, beside the title. **Link row** (`onClick`) is one `<button>` with the head band and a hover background, holding the badge or leading icon, the title, the meta, the `status` and, always last, the chevron; it holds no other control, so `tools` are ignored, and it has an accessible name of title plus detail. **Expandable row** (`body`) is the `details` head of `collapsibleCard`, with the disclosure arrow on the left and no chevron; `actions` are always-visible kit buttons with a text label in its head, while `tools` stay the hover-only icon buttons of form pages. `titleLines` (1-3) clamps the title by CSS while the full text stays in the DOM; a card head has no tooltip; `meta` is the rich line (strings, `{ text, mono?, tone? }` or kit nodes) and replaces `summary` |
| `timeline(items)` with `timeline.item({ marker, tone }, children)`, `timeline.marker(state, { tip })`, `timeline.head(main, meta)`, `timeline.sub(parts, end)`, `timeline.figures(groups)`, `timeline.totals(lines)` and `timeline.note(text)` | A vertical timeline, the kit's first sub-namespace: the parts compose under the root and the older components keep their flat names. `timeline` builds the list (`ul.mg-tl`); `item` (`li.mg-tl-item`, tone `info` for the current entry or `muted` for one that has not happened) takes a marker and any child nodes, nulls skipped. The kit owns the rail, dot, spacing and typography of each slot: `marker` is a compact `statusIndicator` (state name in the tooltip, `tip` replaces it, and the name stays for assistive technology), `head` is the main line (wrapping, left) with a nowrap `meta` (right), `sub` is the muted mono line joined by a dot and cut with an ellipsis, with no tooltip, and an optional `end` node right-aligned on the same line (it drops to its own line when the panel is narrow and wraps between figures when even that is too narrow, never cut or scrolling sideways; null when both are empty), `figures` joins lists of figures with a dot inside a group and a bar between groups (empty groups dropped), `totals` stacks right-aligned lines for a section head, and `note` is a muted paragraph (null when empty) |
| `collapsibleCard({ key, number, title, summary, alerts, warn, open, tools, actions, body, describe, path })` | The collapsible card (`mg-collapsible`), now an alias of `itemCard`'s collapsible mode that never passes `titleLines` or `meta`, so its head DOM is unchanged. See Collapsible card below |
| `menuButton({ label, ariaLabel, items })` | A menu button; `items` is a list of `{ label, onSelect }` |
| `pageTabs({ label, tabs, current })` | The `mg-tabs` nav of `mg-tab` buttons (`aria-current` on the current one); `tabs` is `[{ key, label, onSelect, disabled, title, badge, badgeLabel }]`. A non-zero `badge` is a count pill after the label (`mg-tab-badge`), and `badgeLabel` is then the tab's accessible name, so the number is never read on its own |
| `pageHeader({ state or eyebrow, label, title, clamp, facts, tabs, actions, menu })` | The header all three pages share, in four tiers: the identity row (a status badge `{ icon, tone, text }`, or a plain eyebrow, and an optional label), the title, the facts (`[{ icon, text, title?, tone?, live? }]`; a `live` fact re-computes its text twice a minute) and one row with the `pageTabs`, the page's own `actions` and the more menu |
| `section(title, { level, variant, accent, surface, count, note, actions, children })` | A section: a `.mg-section-head` band with the title, count chip, note and trailing actions, then a `.mg-section-body` that holds `children`. `level: 3` is a nested title, `variant` (`group` or `card`) selects the surface, `surface` puts a page section's body on a card, and `accent` (`true`, `'warn'` or `'error'`) marks an attention state with a toned left edge |
| `group(title, { note, actions, card, accent, children })` | A section nested inside another one; `card` makes it one bordered repeated item, such as an output or a decision route |
| `footer({ children, className, into })` | The sticky `mg-footer` row of buttons |
| `saveFooter({ stateLabel, saving, busy, canDiscard, canSave, onDiscard, onSave, saveLabel, discardLabel, into })` | The sticky save footer (`mg-footer mg-save-footer`): save state on the left, Discard and Save on the right. Pass the earlier footer as `into` to refill it in place; the buttons stay the same nodes, so a click already under way still lands |

**Collapsible card.** A header with a number badge, the title, one quiet `summary` line, `alerts` and, at its right,
`tools` (icon buttons in `mg-collapsible-tools`: move and remove), then the body in `mg-collapsible-body`. The header
is a three-column grid (badge, content, tools) whose first line is as high as a tool: the chevron, the number, the
title and the tools share one middle line at any width, and the tools stay at the right edge. The header is one line:
the title, its warning chips, then the summary (strings joined by a middle dot, most useful first, muted, no frame).
The title is never cut, and the summary is what gives way: it takes the room left beside the title and is cut with an
ellipsis, and only when a chip or a short summary has no room at all does it wrap under the title, so nothing runs
into the tools. The tooltip of the cell carries the title and the whole summary. A summary names only what tells items
apart: a stage shows its role, an agent that is not the role's own, what it needs and its decision count, not the
instruction count nor the default role agent. The tools are also reachable while the card is closed: moving a stage
keeps the focus on the pressed button and removing one focuses its neighbour's header, neither opens a card
(`openAround` leaves a card whose own header holds the focused control closed). `alerts` are warning chips (a problem
count, a duplicate id), the only framed items in a header, so a problem is what stands out. Every item card keeps its
actions in the header, never in the body. `actions` (kit buttons with a text label, such as "Run next step") are
always visible and separate from `tools`; a link row takes neither. The tools show only while the pointer is over
the card or focus is inside it (they keep their space and stay in the tab order); without hover, on touch, they are
always visible. A card given
`describe` (a function returning its current `title`, `summary`, `alerts` and `warn`) exposes `refresh()`, which
redraws the header; the form calls it after every value edit, so a header never lags behind the controls in its body.
The body is spaced like a section body: its blocks keep the block gap. It stays open or closed across repaints by
`key`.

### form.js

| Member | Use |
| :--- | :--- |
| `text`, `number`, `select`, `picker`, `datalist({ id, values })` | A control with `value`, an optional `path` (written to `data-path`), `disabled`, `placeholder` and `onInput` (a `picker` calls `onPick`). A `select` keeps a value its choices do not know, so an imported value is never rewritten. A `picker` looks like a select and asks the page to open its own list. An empty `number` reports `null` |
| `field({ label, control, path, hint, hintWarning, issue, wide, action, density })` | A label, the control and an issue message. A hint is the label itself: dotted underline, the tooltip on hover and keyboard focus, a hidden text node for `aria-describedby`; the issue sets `aria-invalid`. `action` is a node at the far end of the label row, for a control or state that belongs to the field but not to its value, such as the Override toggle of a Local settings unit or the "Overridden" tag of a Project one. `density: 'roomy'` takes the page's wider gap from the kit; a page never restyles the field |
| `grid(children, { density })` | A field grid that reflows from one to several columns; a `wide` field spans every column and `density: 'roomy'` sets the wider gap for every field in it |
| `fieldTag(label, { tone, icon, tip })` | A focusable tag at the far end of a field's label row (`mg-field-tag`), such as "Overridden": an optional codicon, the label, `tip` as tooltip and tail of the accessible name. `tone: 'info'` picks the quiet tone (warn otherwise) |
| `fieldToggle(label, { checked, path, ariaLabel, onChange, disabled })` | A compact checkbox for the field-action slot (`mg-field-toggle`). The kit reports `onChange(checked)`; the page keeps the meaning of the flag and its copy |
| `fieldset(legend, { children, count, path, hint, hintWarning, issue, action })` | A control group with a legend, an optional hint on the legend text, an action at the far end of the legend row and, for a group without one input, its issue |
| `checkboxList({ items, selected, path, onChange, onEdit, onRestructure })` | Checkboxes; an unknown item carries `unknown` and uses the warning tone |
| `stringList({ values, ... })`, `pairList({ pairs, ... })` | Add and remove rows; they mutate the draft in place, report a value change through the form `root`, and call `onEdit` and then `onRestructure(path)` after add or remove |
| `root({ children, onEdit })` | The form's root node. One delegated `input` and `change` listener reports every value edit inside it through `onEdit`, so a control never has to call it; it lays out as its children (`display: contents`) |

A form page renders its controls inside `root`. `root` is the only place a value edit becomes an `onEdit` call: a page
callback just writes the new value into the draft, and `onEdit` then marks the page dirty and refreshes what depends on
it, such as a Save button. Add, remove and pick actions are clicks, not value edits; they call `onEdit` themselves, or
rebuild through `onRestructure`.

### page.js

`media/shared/page.js` defines `MigentPage`, the connection to the extension. It builds no component.

| Member | Use |
| :--- | :--- |
| `connect({ render })` | Own the VS Code API handle, the revision guard on the message's top-level `revision`, `setState` and the `ready` handshake. Calls `render(model, transient)`, where `transient` is the message's optional host state (undefined when the host posts none) and never part of the model. Returns `{ send, post, action }`; `send(intent)` adds `type: 'intent'` and the current revision. `post(message)` sends a page-typed message unchanged, for a page whose host validates its own message set. It adds no revision and the host still validates every field. `action(label, intent, kind)` is a kit button that sends `intent` |
| `trackFooter()` | Keeps `--mg-footer-height` equal to the height of the page's `.mg-footer`; `connect` calls it after each host model, and a page that re-renders on its own calls it |

A model update rebuilds the page. State that must survive it (open `details`) is kept by the kit; an open menu closes
on re-render.

### Session header

The session domain is not part of the kit. `media/session/sessionHeader.js` defines `MigentSessionHeader`:
`sessionHeader(page, options)` builds the Session page header over `pageHeader` (the status badge, the facts and
the session menu items), `sessionFacts(meta)` is the fixed list of facts, and `sessionStates` maps
each session state to its icon and tone. `utils.js` holds the pure time formatting it uses (`formatDuration`,
`formatAgo`, `parseTime`, `describeTime`, which gives the relative text and the absolute local time for a
tooltip). `sessionHeader.js` also holds `decisionTone` beside `sessionStates`.

## Shared agent form and draft page

`media/shared/agentform.js` defines `MigentAgentForm`, the agent controls the workflow form and Configuration page share:
`inlineEditor` (model picker, effort and client options over the flat shape
`{ model, effort, clientType, clientOptions }`), `selector` (the "named or inline" select, given the modes a page
allows), `namedOptions`, `datalists` and the client-list helpers (`isKnownModel`, `agentModelLabel`,
`optionKeySuggestions`). Its text is `MigentCopy.agent`.

`media/shared/draftpage.js` defines `MigentDraftPage`, the draft handling the form pages share: `createUnit` (the
draft, the last adopted form, `isDirty`, `adopt(form, keepDraft)`, `discard`, and the `submitted` marker that keeps
edits made while a save is in flight), `createPicker(post, apply)` (routes one pending `pickModel` to its
`modelPicked` reply; `post` is the page's own `post`, so the picker never takes the API handle) and `createChrome`
(the notices area and sticky footer, refreshed in place after an edit). `notices()` returns an empty host that the
page places under the header. The page calls `fillNotices()` after it has mounted the form, so an issue is classified
against the controls the form really drew: a link when `controlOf` finds one, text otherwise. `refresh()` refills
both in place after an edit.
Whether a dirty draft survives
a disk refresh is the page's policy, passed as `keepDraft`: the Workflow editor keeps it only while the file's hash is
unchanged, the Session page's Workflow tab keeps edits made after the submit, and the Configuration page keeps a dirty
tab and its save base.

`agentform.js` and `draftpage.js` load for every page: they are small, and loading them per page would widen the
`PageDescriptor` for little gain.

A form page keeps its own data shape, validation and repaint. The kit reads no model. The Workflow editor is its
first consumer; another page adopts it by passing the draft it already owns.

A hint belongs to a control: `field` and `fieldset` take one and render it as a small icon with the text as its
tooltip. Layout blocks (`section`, `group`) never carry a hint; their note is a line of text.

## Tokens

`base.css` maps VS Code theme variables to `--mg-*` custom properties. Colors come only from `--vscode-*` variables,
each with a fallback; never hard-code a color. A page stylesheet uses the `--mg-*` tokens; it reads a `--vscode-*`
variable directly only when no token covers it, and then the variable belongs in `base.css` as a new token. The one
exception is the editor-tab icon images (see [Icons](#icons)).

| Token group | Source |
| :--- | :--- |
| Text: `--mg-fg`, `--mg-muted`, `--mg-link` | `foreground`, `descriptionForeground`, `textLink.foreground` |
| Tone: `--mg-ok`, `--mg-warn`, `--mg-error`, `--mg-info` | `testing.iconPassed`, `list.warningForeground`, `list.errorForeground`, `charts.blue`: the colors of the Sessions view state icons |
| Surface: `--mg-surface`, `--mg-surface-2`, `--mg-hover`, `--mg-border` | `editorWidget.background`; `--mg-surface-2` is 6% of the text color over it and `--mg-border` is 18% of the text color over the editor background, so the steps hold in every theme; `list.hoverBackground` |
| Page and states: `--mg-bg`, `--mg-selected` | `editor.background`, for sticky bars that hide what scrolls under them; `list.inactiveSelectionBackground` for a selected row |
| Quote: `--mg-quote-bg`, `--mg-quote-border` | `textBlockQuote.background` and `textBlockQuote.border` |
| Accent: `--mg-accent`, `--mg-accent-fg` | `button.background` and `button.foreground`: the primary button, and a marker that shows a selected choice |
| Label: `--mg-label` | 75% `--mg-fg` over `--mg-muted` |
| Focus: `--mg-focus` | `focusBorder` |
| Bar: `--mg-bar` | `progressBar.background`, then `textLink.foreground` |
| Spacing: `--mg-space-1` to `--mg-space-5` | 4, 8, 12, 16 and 24 px |
| Radius: `--mg-radius`, `--mg-radius-sm`, `--mg-radius-pill` | `cornerRadius-medium` (6 px fallback) for cards, sections and menus; `cornerRadius-small` (4 px fallback) for buttons and fields; 999 px for pills, chips and bars. A page never writes a literal radius |
| Type: `--mg-font`, `--mg-font-size`, `--mg-mono` | The editor and UI fonts |

## Icons

One vocabulary everywhere: [codicons](https://github.com/microsoft/vscode-codicons), the icons of VS Code and of the
Sessions view. Never a Unicode glyph or a page-drawn icon. The icon says *what*, the color says *state*.

| Where | Icon | Color |
| :--- | :--- | :--- |
| State badge (`mg-status`) | The state's icon, the same as the Sessions view (`DISPLAY_STATE_ICONS`): `sync` running, `comment-discussion` question, `warning` blocked, `error` failed, `pass` completed, `debug-pause` stopped, `circle-slash` cancelled, `circle` prepared, `question` unknown. Progress rows share the same `sessionStates` map and add the progress-only `circle-outline` not run and `skip` skipped. A page with its own states (Questions, Next step) picks from the same set | Tone of the state: blue running, yellow question and blocked, red failed, green completed, neutral otherwise |
| Item and reference tools | `copy` copy value, `go-to-file` open file or workflow, `file` an output, `chevron-right` the link affordance | Text color; the tooltip carries the state |
| Session fact chip | `milestone` stage, `watch` duration, `history` time since the last update (pending questions are the Questions tab's badge, not a fact) | Text color |
| Page progress | `checklist` answered count (Questions) | Text color |
| Form hint | None: the label carries a dotted underline and the tooltip | The label's own color; the warning tone for a value that needs a change |
| Editor tab | One per page, in `media/tab-icons`: `comment-discussion` Questions, `dashboard` Overview, `graph` Metrics | The session state's tone, as in the badge and the Sessions view (`stateTone`). A tab takes an image, so there is a file per page, tone and theme, and the host swaps it when the state changes. These files are the only fixed colors, because an image cannot read theme variables; see the table below |

Tab icon files are filled with fixed colors, one per tone and theme, taken from the VS Code default dark and light
themes. They do not follow a custom theme, so keep them in step with the tone tokens when a source color changes.

| Tone | Dark | Light | Matches |
| :--- | :--- | :--- | :--- |
| `ok` | `#73C991` | `#388A34` | `--mg-ok` |
| `warn` | `#CCA700` | `#855F00` | `--mg-warn` |
| `error` | `#F88070` | `#A1260D` | `--mg-error` |
| `info` | `#3794FF` | `#1A85FF` | `--mg-info` |
| `muted` | `#C5C5C5` | `#424242` | `--mg-muted` |

`media/shared/icons.js` holds the SVG paths (`window.MigentIcons`) and `MigentUi.icon(name)` draws one in the
current text color. To add an icon, copy it from codicons (CC BY 4.0; keep the header of `icons.js`) and use its
codicon id. A test checks that the badge icons match `DISPLAY_STATE_ICONS`.

## Components

| Component | Classes | Use |
| :--- | :--- | :--- |
| Page header | `mg-header`, `mg-title`, `mg-subtitle`, `mg-actions`, `mg-eyebrow` | Status, title, one-line subtitle and the page's actions. Built with `pageHeader`. The Session page renders `sessionHeader` (`media/session/sessionHeader.js`) once above all its tabs, in four tiers: status badge and workflow id; the title (two lines at most, full text in its tooltip); the session's facts (the same on every page and in a fixed order: stage, duration, time since the last update; each hidden when unknown, the duration running to now while the session runs, and both clocks refreshing every 30 seconds); and one row with the `mg-tab` page switches (Overview, then Questions, always shown, disabled until the session asks a question (`header.hasQuestions`, which the panel sets on every post) and with a badge counting the questions waiting for an answer, then Metrics and Workflow; the current one is underlined, with `aria-current`) followed directly by the borderless more menu (View log, Copy session ID, Reveal in Explorer, and Complete session… only when the host sets `meta.canComplete`, which excludes running, prepared, completed and role sessions). Tabs are a list, so a page is added with one entry |
| Alert | `mg-alert` with `mg-warn` / `mg-error` | A problem or explanation that stays visible, wrapped inside the page width |
| Banner | `mg-banner` with `mg-banner--ok` / `--warn` / `--error` (info otherwise), an `mg-banner__icon` and one paragraph per message | A message about the page or the session that deserves a block of its own: an icon and a left edge in the tone of the message. Built with `MigentUi.banner`; the Workflow editor, Configuration and the Session tabs use it |
| Text field | `mg-input`, `mg-textarea`, `mg-select`, `mg-picker` | A single-line input, a text area, a select or a picker; the select and the picker use the dropdown colors |
| Form field | `mg-field`, `mg-field--roomy`, `mg-field-head`, `mg-label`, `mg-has-hint`, `mg-issue`, `mg-field-grid`, `mg-field-grid--roomy`, `mg-field--wide` | One labelled control with a hint on its label and an issue message, in a grid that reflows; a wide field spans every column. The `--roomy` variants are the kit's wider gap, chosen by `density`, not by a page rule |
| Field tag and toggle | `mg-field-tag`, `mg-field-tag--info`, `mg-field-toggle` | A focusable tag at the end of a label row (an overridden value) and a compact checkbox that reports its state; built with `fieldTag` and `fieldToggle` |
| Field group | `mg-section--group`, `mg-fieldset`, `mg-legend` | A named group of controls inside a stage: a section with an uppercase `h3`, a note line and optional trailing actions |
| Section head | `mg-section-head`, `mg-section-title`, `mg-section-note`, `mg-section-actions` | A sticky band with the title, count chip, note and trailing actions; it stays at the top while its section scrolls, so a long page always names the block in view. A nested section keeps its head inline. The first block under a head takes no margin of its own, so every section opens with the same gap |
| Section body | `mg-section-body` | The content area under a section head; `mg-section--surface` puts it on a card |
| Section card | `mg-section--card`, `mg-section--accent` | One repeated item such as a decision route or an output: a bordered section whose head names it and carries its remove action |
| Checkbox list | `mg-checks`, `mg-check` | A wrapped list of checkboxes; `mg-check--unknown` marks an imported value the page does not know |
| Badge and chip | `mg-badge`, `mg-chip` with `--info` / `--warn` / `--error` | A number that anchors a stage, or a short quiet value such as a role, an agent kind or a count. A chip is built with `chip` |
| Section add action | `mg-add-block` (`addBlockButton`) | The add action of a whole section list (stages, artifacts, suggestions): a full-width button with a dashed outline and a plus icon, as the last child of the section body, not in its head, so it is a large target where the new item appears. An empty list passes `empty`: one dashed frame holds the message and, under it, the button without an outline, so the dashed outline always means "click to add" |
| Row action | `mg-inline-row`, `mg-btn--danger`, `mg-add` | One editable row with a trash-icon remove action, then a compact add action (plus icon, muted at rest and in the link color on hover or keyboard focus, so it stays below the dashed section add button). A danger button is muted at rest and takes the error tone and frame only on hover or keyboard focus, so a list of rows is not a wall of red |
| Empty block | `mg-empty` | A dashed block that states what is missing instead of leaving a blank area. Built with `empty` |
| Action footer | `mg-footer` | Sticky bar of buttons that wraps at narrow widths and takes its own space, so it never covers content. Built with `footer`; the save footer is `saveFooter` |
| Status indicator | `mg-status`, `mg-status--ok` / `--warn` / `--error` / `--info` / `--muted`, `mg-status--compact`, `mg-visually-hidden` | The state of the thing the page describes. Always an icon plus text plus color; `compact` hides only the text visually, keeping it for assistive technology and in the tooltip. Built with `statusIndicator` |
| Buttons | `mg-btn` with `--primary`, `--secondary`, `--quiet`, `--link`, `--danger` | One primary action per page. Secondary for other actions. Quiet for a minor tool; an icon-only one such as move up or down uses `iconButton`. Link for an inline reference. Danger for every action that removes or discards something: it takes the error tone and is quiet until hover, so a list of rows is not a wall of red. A remove action is an icon-only trash button (`mg-btn--icon`, square) whose `aria-label` and tooltip name the row, so it stays compact in a card head or an editable row. A `disabled` button is dimmed |
| Button size | `mg-btn`, `mg-btn--sm`, `--mg-btn-height` | Two sizes: standard (28px, 4px and 12px padding) and compact (`--sm`, 24px, 2px and 8px). Use compact for an action inside a row or a tool strip; a quiet or danger button is compact by default and `button(label, { size })` overrides it. A bordered button never sets its own padding or height |
| Menu button | `mg-menu`, `mg-menu-list`, `mg-menu-item` | Less common actions; built with `menuButton` |
| List row | `mg-list`, `mg-row`, `mg-row-main`, `mg-row-meta` | One item with a label and trailing metadata. A `<button>` row is clickable; a `<div>` row is not. Built with `listRow`; a list of rows is `denseList` |
| Plain list | `mg-list--plain` | Lines without dividers, such as activity, commands or inherited options. Built with `plainList` |
| Timeline | `mg-tl`, `mg-tl-item`, `mg-tl-item--info` / `--muted`, `mg-tl-marker`, `mg-tl-body`, `mg-tl-head`, `mg-tl-main`, `mg-tl-meta`, `mg-tl-subline`, `mg-tl-sub`, `mg-tl-sub-end`, `mg-tl-sep`, `mg-tl-totals`, `mg-tl-note` | Entries on a vertical rail, one status dot each and no frame. The rail is a `::before` line in the `--vscode-editorWidget-border` family that stops at the last entry; the head wraps, so a narrow panel never scrolls sideways. Built with `timeline` |
| Item card | `mg-item`, `mg-item--static` / `--link` / `--info` / `--warn` / `--error`, `mg-item-head`, `mg-item-leading`, `mg-item-main`, `mg-item-title`, `mg-item-title--clamp-1` / `-2` / `-3`, `mg-item-summary`, `mg-item-meta`, `mg-item-alerts`, `mg-item-end`, `mg-item-afford`, `mg-item-link`, `mg-collapsible-actions`, `mg-badge` | The bordered item of a list, one look per interaction kind: **static** (the card surface only, no head band, no hover, no chevron), **link** (the head band and hover; one `<button>` around the icon, title, meta, status and the trailing chevron, which is always last) or **expandable** (the `mg-collapsible` head, with always-visible `mg-collapsible-actions` buttons apart from the hover-only `mg-collapsible-tools`). `titleLines` clamps the title by CSS and keeps the full text in the DOM and the tooltip; `meta` is the rich line (mono segments, references). Built with `itemCard` |
| Key-value | `mg-kv`, `mg-kv-value`, `mg-kv-tools`, `mg-kv--dense` | A quiet label and its value, with an optional tool at the end of the row. Built with `keyValues` |
| Reference value | `mg-ref`, `mg-ref--id`, `mg-ref--hash`, `mg-ref--path` | A mono id, hash or path, cut at the end by CSS (`id`, `hash`) or wrapped (`path`), with the full value in `data-tip`. Built with `refValue`; its copy tool is separate |
| Stacks | `mg-card-stack`, `mg-block-stack` | The rhythm between item cards, or between blocks of a body. Built with `stack` |
| Card | `mg-card`, `mg-card-title`, `mg-card-body`, `mg-tags` | A whole-card action with a short summary. Never put another control inside it. A group that holds controls is not a card |
| Pill | `mg-pill` | A short value such as a state or an artifact name. It labels; it does not act. Built with `pill` |
| Details | `mg-details`, `mg-details-summary`, `mg-details-arrow`, `mg-details-heading` | One shared collapsible: a chevron in its own box, then the header. Secondary information and secondary actions, closed by default. Built with `details` |
| Section | `mg-section` | A titled block of the page: one `mg-section-head` and one `mg-section-body`; a nested block adds `mg-section--group` or `mg-section--card` |

Choose by purpose: a **row** lists many similar items, a **card** offers an action with context, a **pill** tags,
the **status indicator** reports state, and **details** hold what a reader needs only sometimes. A problem the reader
must notice (a warning, an error, a reload action) stays visible outside any details control.

Inside a form, a **section** is a page region with one head and one body, a **group** is a named section inside a
stage, and a **field** is one labelled control. A repeated item is a card section of its own. Every block uses the
same head and body, built with the UI kit rather than page-local markup.

A bar (`<progress>`) is decorative: it uses `--mg-bar`, is hidden from assistive technology and always sits beside its
numeric value, so a value is never conveyed by length or color alone. Size a bar through properties (`max`, `value`),
never an inline `style` attribute.

## Visual hierarchy

Every block in a form is one of these levels, and each level has one look, so depth reads at a glance. Pages never
restyle a level; they choose it.

| Level | Component | Look |
| :--- | :--- | :--- |
| 1 | Section (`mg-section`) | Large semibold title (1.3em) on a sticky head, marked by a 3 px bar in `--mg-focus` on the left of its line, so a section is found at a glance while scrolling; its body sits on a surface |
| 2 | Repeated item: `mg-item` (static, link or `mg-collapsible`) or section card | Bordered card on `--mg-surface` with a title-case title (1em, semibold, full text color). A **static** row has no head band, no hover and no chevron; a **link** row has the head band on `--mg-surface-2`, a hover background and the trailing chevron; an **expandable** row has the band, the disclosure arrow on the left and its actions. So a fact, a link and a disclosure are told apart without color. A list of items is a `mg-card-stack` |
| 3 | Group (`mg-section--group`) | Bold uppercase title in full text color over a one-pixel rule |
| 4 | List legend (`mg-list-editor > mg-legend`) | A list's name above its rows: 0.9em, semibold, full text color, with its count chip, on a 2 px left rule in `--mg-border` that the rows hang from. It reads above the labels inside it and below a card title |
| 5 | Field label (`mg-label`, `mg-legend`) | Small (0.85em), medium weight, normal case, in `--mg-label`: a step quieter than the text, so it recedes from the value it names |

- Titles weaken one level at a time: a group title never reads quieter than the field labels it holds, and a card
  title never shares the group style.
- Only a repeated item is a card. A named block of controls is a group.
- `mg-item` and `mg-section--card` are one card: the same frame, surface and head band. The static and link modes are
  the one-line item; the collapsible mode is the one that opens and closes; use it for an item with a lot inside.
- A link item is one `<button>` that holds everything: the icon, title, meta, `status` and, always last, the chevron.
  It never holds or sits beside another control, and `tools` are ignored in link mode, so a row has one tab stop.
- Level 4: a card inside an item card keeps its frame, so every item has an edge, and shows its depth by surface:
  `--mg-surface` for the outer card, the editor background for the card in it, and `--mg-surface` again for a card
  in that. Never remove a card's frame to show depth.
- A closed block says what is inside it: a stage's summary counts its decisions, and Advanced
  settings shows its verify commands and path filters beside the title (`mg-summary`).
- A list editor (`stringList`, `pairList`) is one block: a left rule, and a count chip beside its label, so it reads
  as one array and not as several fields.
- The tools row of a card keeps a frame on each action so it reads as buttons.

Spacing follows the relationship, through four tokens in `base.css`; a page never sets a margin of its own between
these blocks:

| Token | Between | Value |
| :--- | :--- | :--- |
| `--mg-gap-field` | Two fields in one grid | 12 px |
| `--mg-gap-block` | Two blocks in one body (a field grid and a list). A stack outside a section body is `mg-block-stack` | 16 px |
| `--mg-gap-card` | Two cards | 12 px |
| `--mg-gap-group` | Two groups | 24 px |

## Layout and states

- One column, at most 960 px wide, with the header first, then sections in order of importance.
- Spacing comes from the spacing tokens; headings are `h1` (page title), `h2` (section) and `h3` (inside details).
- An empty section states what is missing in muted text. An error uses `mg-error` or `mg-warn` text that names the
  cause. An unavailable page keeps its explanation and the session id.
- A missing or rejected file renders as a non-clickable row that carries its reason.

## Theming and accessibility

- Light, dark, high-contrast dark and high-contrast light must render legibly. In high contrast `--mg-border` and
  `--mg-focus` switch to `--vscode-contrastBorder` and `--vscode-contrastActiveBorder`.
- Status is never conveyed by color alone: pair it with an icon and text.
- Every action is a native `<button>` or `<summary>`; focus outlines use `--mg-focus`.
- A menu button follows the WAI-ARIA menu-button pattern: `aria-haspopup`, `aria-expanded`, `role="menu"` and
  `role="menuitem"`. Enter, Space and ArrowDown open it; arrows, Home and End move focus; Escape closes it and returns
  focus to the trigger; Tab and an outside click close it.

`page.js` keeps `--mg-footer-height` equal to the height of a sticky `mg-footer`, and `base.css` uses it as
`scroll-padding-bottom`, so a focused control or a scroll target stops above the footer even when its buttons wrap.

Check a UI change by hand: Tab order, the menu keyboard behavior, `<details>` with Enter and Space, and all four
themes. Automated tests drive the shared `connect`, the UI kit on its own (no host adapter loaded), the Session
page's Overview, Questions, Workflow and Metrics tabs and the workflow form against a small fake DOM
([uiKit.test.ts](../src/vscode/webview/uiKit.test.ts),
[pageScript.test.ts](../src/vscode/webview/pageScript.test.ts),
[questionsPage.test.ts](../src/vscode/webview/questionsPage.test.ts),
[overviewPage.test.ts](../src/vscode/webview/overviewPage.test.ts),
[sessionWorkflowPage.test.ts](../src/vscode/webview/sessionWorkflowPage.test.ts),
[workflowForm.test.ts](../src/vscode/webview/workflowForm.test.ts)); they do not check layout or themes, so record
the manual pass in the pull request.

## Add a page

1. Create `media/<page>/` with a stylesheet for layout only and a script that calls
   `MigentPage.connect` once and takes its components from `MigentUi`. Take shared text from `MigentCopy`.
2. Describe the page with a `PageDescriptor` and use `renderPage` for the HTML and `pageResourceRoots` for
   `localResourceRoots`, both for a new panel and when restoring one.
3. Define the model in `src/core` as inert JSON and validate every message in `src/core` before the host acts on it.
4. Assemble the page from the builders in the tables above (`components.js` and `form.js`), without writing `mg-*`
   classes by hand. Add a builder to `components.js` and its styles to `base.css` only when two pages need it, and
   document it here.
5. Add the manual checks above to the pull request.

## Pages on the foundation

| Page | Assets | Notes |
| :--- | :--- | :--- |
| Session | [media/session](../media/session) | One page for a session: a shared header (`session.js` over `sessionHeader.js`) and four tab renderers, `overview.js`, `metrics.js`, `workflow.js` and `questions.js`, each exposing `render(container, model, page)`; the Overview tab composes the fixed block order in `overview.js`, with `overviewProgress.js` drawing Progress and Latest activity and `results.js` drawing the results blocks; `session.css` holds the page-local styles. The shell renders the header and the body of the tab the host last posted; the Questions tab keeps one mount for the life of the page so a background update keeps its draft, focus and caret, and the other tabs are redrawn on every model. **Overview**: Status, Progress, Latest activity, Outputs, Next steps and Child sessions, in that fixed order, then on a child session the source Details grid with no section, owned by `overview.js` (`results.js` returns its sections by name). Every section is `MigentUi.section` with a note, a body of kit builders, and a count chip only when it holds two or more items. Next steps and Child sessions render only when they have data. **Status** is one surface section: the overall state badge always (icon, text, tone) followed by the reason line when there is one, the quiet facts as a `keyValues` grid (blocked in, blocker, quota reset, latest update; the latest execution and decision are Progress's), then the actions: at most one primary action plus ordered secondary actions (Stop is the only danger), and for a Completed session the next action decided by core (`OverviewModel.nextStep`): no button when exactly one suggestion can launch and has not run (its Next steps card is the action), a line pointing to Next steps when several can or when none can, and "Nothing left to run." when every suggestion ran or there are none; a state with no action says so. Blocked, failed, question and unknown states take a toned edge. **Progress** is a `timeline`, one entry per attempt of every stage in the order they ran (by execution order), or one per execution for a role session. The state is the dot only (icon and tone; its name and the absolute start and finish times are in the tooltip and the text for assistive technology). An attempt that ended by asking (`outcome.status: question`) takes the question state (`comment-discussion`, warn tone, "Asked a question" in the tooltip) instead of its run state, and an `asked` badge. The main line is the stage, `#attempt`, the decision badge, that badge and a muted run-reason label, with only the duration on the right. The label comes from core (`AttemptFacts.reason`, from `turn_kind` and `routed_from`): `← after your answer` for `answers`, `← revise from <stage> #n` for `continue` routed from an attempt that decided `revise`, `← routed from <stage> #n` for any other routed source, and nothing for `start`, a `continue` without a source or when the data does not say; `resumes <stage> #n` is only the label's tooltip. Under it, in muted mono, the model and effort (cut with an ellipsis, no tooltip; no client) on the left and the usage cluster right-aligned (cost, then `in` and `out`, then `cw` and `cr`, as in `0.09$, 8 in · 1.1k out, 16k cw · 3.7M cr` with bars between the groups) right-aligned: each number is one `metrics.json` field (`cost_usd`, `input_tokens`, `output_tokens`, `cache_write_tokens`, `cache_read_tokens`), never combined; a zero is shown, a null is left out together with a group it empties, and `cw`, `cr` and `out` carry tooltips (`out` adds the reasoning tokens when reported). `input_tokens` is taken as already excluding cached tokens, an assumption read from Codex sessions (input far below cache read) and not checked against the Migent CLI; since each figure is shown alone, nothing is double counted. Below, a blocker or the recorded error (`execution.json` failure reason and error, one line) as a note. Every part is left out when the data lacks it, so a session without `metrics.json` shows no duration or tokens and no placeholder. The section head counts the attempts and adds `active` (the sum of the attempt durations) and `wall` (`metrics.json` `totals.wall_seconds`, passed through `OverviewInput.wallSeconds`) above the summed usage cluster, each part left out when unknown; the total cost reads `M$+` with a tooltip counting the attempts without a cost when only some report one. Each stage that never ran follows with an empty dot and muted text, in workflow order, and the current stage tones its latest entry. A decision is a status badge with a tone (`decisionTone`): `approved` and `approved-with-comments` ok, `revise` warn (icon `edit`), any other value neutral. **Latest activity** shows the five newest event lines as a mono plain list, only while Running. **Outputs** is one link row per file (file icon, label, the mono path only when it is not `outputs/<name>.<ext>`, the stage and attempt that published it and when); a missing or rejected file is static with a warning chip. **Next steps** is one simple card per suggestion (workflow, then the task and "Ran → child" naming the newest child session that ran it): a launchable step is a link card that runs it on click, an invalid or duplicate target is a link card with its block-reason chip that opens the workflow file, and any other blocked step is a static card with its block-reason chip; a missing `next.json` or no suggestion shows no section, and an unreadable or invalid one is a warning `banner` with "Open next.json". **Child sessions** is a link row per child: the task clamped to two lines, its session id as a CSS-cut `refValue`, its current stage, its creation time and its state through the shared map before the chevron. **Source Details** (on a child session) is one ruled "Details" disclosure after the last section, with no section of its own, open until the reader closes it, holding a two-column `keyValues` grid: `upstream` (the parent session as a link button that opens it while retained, else its title and the reason), then one row per handoff file whose path is a link button that opens the local copy (a warning chip when it cannot); the page shows no handoff hash, source path or source output. A link row holds no other control, so a child's id is copied from the child's own header menu. The Overview needs no page stylesheet. **Metrics**: read-only metrics of one completed session: partial-cost warning, summary, stages, usage, executions (one `collapsibleCard` each with its order, stage and attempt, role, status, client, time and cost; the last open), details, all as `MigentUi.section` blocks; `missing`, `invalid` and `unreadable` files get an explanation instead of zeros, and a skipped execution shows its reason and no token or cost story. **Workflow**: errors and warnings as the same summary banner with a link per issue as the Workflow editor, and the session's `workflow.yaml` in the shared workflow form (`workflowCopy.js`, `workflowModel.js`, `workflowForm.js` and `workflowForm.css`, loaded through the descriptor's `modules`); every field is disabled once any stage has an execution (`model.isLocked`), and before that Save workflow writes the draft with `migent workflow save --session` (disabled when unchanged or invalid; Discard restores the saved form). **Questions**: one attempt (execution) at a time. A session that never asked a question shows a `MigentUi.empty` state. Otherwise a sticky bar holds two columns that stack when narrow: on the left a kit `select` of every attempt that asked questions, in the order they ran (`stage - attempt N`), which starts on the latest attempt still waiting, else the latest one; on the right, aligned to the end, the jump chips of the shown attempt (the number, then a check once answered, the one in view marked, the question as tooltip). Below it: the state message and block reason as one `MigentUi.banner` whose tone follows the batch state (green once the answers are recorded, yellow or red when it needs attention or the attempt was never answered; none while sending); one kit card `section` per question (the question as its title, the selection mode as its note and a `statusIndicator` as its action; context as a quote) whose options are whole rows (a visually hidden native radio or checkbox, with the letter badge as its marker, then label, description and Recommended pill), and an Other row that is one more choice and opens a focused text area; ambiguity warnings as `alertLine` and recorded answers as a `keyValues` row; a read-only previous draft in details; and a sticky `mg-footer` with Discard draft and Send answers (showing how many answers are left, and a disabled spinning Sending… in its place while the send is in flight), or the state's recovery action (Load the new questions, Check again, Continue the stage) when it is not Answering. An attempt that waits is a form; an answered or superseded one is a read-only record with no footer. Only the principal action of the state is primary. The bar, option rows and the context quote are page-local styles |
| Workflow editor | [media/workfloweditor](../media/workfloweditor) | Edits one schema 5 workflow file: header, Design form, CLI diagnostics and a sticky Save/Discard footer; the YAML tab opens the file in the editor. A stage picks the role agent, a named agent from `config.yaml`, or a complete inline agent (provider, model, effort, client and client options), matching `workflow save --preserve-comments`. Save posts the form draft as YAML to `migent workflow save - --target <file> --format yaml --base-hash <sha256> --preserve-comments --json`; the host accepts only the versioned envelope, keeps the draft on an invalid result or a stale base, shows each diagnostic, and clears diagnostics when the draft changes. Other schema versions stay read-only with a migrate hint. The Design controls are a reusable module, `workflowForm.js` with its layout stylesheet `workflowForm.css` (`MigentWorkflowForm`; the data shape, the pure draft operations such as `moveStage`, `removeStage` and `renameStageReferences`, and the option-list builders live in `workflowModel.js` (`MigentWorkflowModel`), which builds no DOM and loads before the form; the save footer and notices come from the form kit): `create({ getModel, getForm, issues, onEdit, repaint, pickModel })` renders the form over a draft the host page owns; `emptyForm` and `normalizeForm` define its data shape. Each stage, artifact and downstream suggestion is a kit `collapsibleCard`, closed by default: a stage's header carries its number and id, then a summary of role, a non-default agent, what it needs and its decision count, an artifact's its id, file and whether it is required, and a suggestion's its workflow, task and mapping; each shows a problem chip when an error is inside it. A card that holds the control being focused (a new item, or an issue the reader is taken to) opens first. Inside, the settings are grouped as Identity, Inline agent (only for an inline agent), Dependencies, Instructions, Decisions and an Advanced details block, so a stage reads top to bottom without repeating legends. Section heads are sticky bands that owe their separation to a surface, not to a divider; a decision route is a shared panel with its own remove action. Only controls carry a hint icon. The controls and their layout come from the UI kit. Reference fields are closed lists: role and named agent from `config.yaml`, downstream workflow from the project's other workflow files, output source and artifact from the chosen stage, resumed session from the stage's dependencies, and decision destinations from the draft's other stages plus `complete`, one per decision and never the stage itself, while an imported route to several stages or to its own stage stays visible with a warning; a value the list does not know stays visible so an imported file is never silently rewritten. An inline agent's Model is one picker over the same searchable, provider-grouped list as initialization; it writes the provider and model together. Effort stays beside it, and client options follow the pair. An imported provider, model or client value is kept and shown on the picker; a pair the list does not cover is changed in the workflow file. Option keys come from `migent get options --client <id> --native` and models from `get models --client <id>`, for each client in `get clients`, read once per project and refreshed by Reload, and effort uses the values the Migent CLI documents. The page asks the host with a `pickModel` message and applies the `modelPicked` choice to its own draft, so every other edit stays in place. It loads after the kit and before the page script |
| Configuration | [media/config](../media/config) | Edits `.migent/config.yaml` (Project) and `.migent/config.local.yaml` (Local) as Agents and Roles sections of collapsible cards (`config.js` the shell, `configform.js` `MigentConfigForm`, `configcopy.js`); the YAML tab opens the active file. Each tab has its own draft, dirty state and save intent (replace with the hash it was read at, or create when started from a missing file). On Local every setting the CLI merges on its own (an agent's model, effort, client type and each client option, a role's description, its responsibilities and its whole agent) has an Override toggle at the end of the field's label row; absent inherits `config.yaml` and present (even empty) overrides it, and while a unit is inherited its control stays in place but disabled, holding the value from `config.yaml`. On Project each such unit that the saved `config.local.yaml` sets carries an "Overridden" tag in the warning tone at the far end of its label row, with a warning icon and a tooltip explaining that `config.local.yaml` sets it, so the field shows both its own value and that it is overridden. A clean tab adopts a changed file; a dirty tab keeps its draft and shows a changed-on-disk notice with Reload. A diagnostic from the other file is labelled with that file |

## Questions message contract

The Session page's Questions tab keeps its own message set because its host validates edits against a generation and a fingerprint.

- **Model.** The host posts `{ type: 'model', revision, identity, model }` where `model` is the Session page model,
  the shown attempt's answer model is `model.questions.model` and the attempt list is `model.questions.attempts`.
  The top-level `revision` counts the panel's posts and is what `connect` guards on (a message without it is
  ignored); the answer model carries its own `revision`, which `submit` echoes.
- **Page messages.** The page sends `edit`, `submit`, `reload`, `discard`, `recheck`, `continue`, `viewLog`,
  `openQuestions` and `later` with `post`, and `openOverview` and `openMetrics` to switch tab. `parseSessionPageMessage`
  in `src/core/sessionPageIntent.ts` routes them to `parseAnswerMessage` in `src/core/answerModel.ts`, which validates
  them; `edit` carries the generation and fingerprint, `submit` the revision and fingerprint, and the host drops a
  stale one.
- **Drafts.** A model with the same generation and fingerprint as the shown one keeps the local draft over the host's
  echo; a new generation or fingerprint replaces it. A re-render keeps focus, text selection, scroll and expanded
  context. Ctrl or Cmd with Enter sends only when the Send answers button would be enabled.
