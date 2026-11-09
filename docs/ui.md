# Webview UI

This page defines how Migent webview pages are built: the shared page foundation, the design vocabulary and the
rules every page keeps. Every page (Session, Next step, the Workflow editor and Configuration) is on the foundation.
For module ownership see [Architecture](architecture.md); for how to verify UI changes see [Testing](testing.md).

## Page architecture

A page is a webview panel whose HTML, styles and script come from `media/`. Three layers own it:

| Layer | Location | Owns |
| :--- | :--- | :--- |
| Host helper | [page.ts](../src/vscode/webview/page.ts), [pageHtml.ts](../src/vscode/webview/pageHtml.ts) | The HTML skeleton, the content security policy, the nonce, asset order and `localResourceRoots` |
| Shared assets | [media/shared](../media/shared) | Tokens and component styles (`base.css`, including the save footer, notices and collapsible card), pure helpers (`utils.js`), icons (`icons.js`), shared copy (`copy.js`), page helpers (`page.js`), the form kit (`form.js`) |
| Page assets | `media/<page>/` | Layout and rendering of one page; no tokens or component styles of its own |

A page is described by a `PageDescriptor`: its `media/` folder, its own stylesheet and script names and its title.
The helper never takes HTML fragments or user data, so a page cannot weaken the policy.

- **Policy.** `default-src 'none'; style-src <cspSource>; script-src 'nonce-<nonce>'`. A fresh nonce is generated for
  every render and set on every script. No inline script or style, no remote resource.
- **Order.** The shared stylesheet loads before the page stylesheet, and the shared scripts (`utils.js`, `icons.js`, `copy.js`,
  `page.js`, `form.js`, `agentform.js`, then `draftpage.js`) before the page script. The page script depends on the
  globals `MigentIcons`, `MigentCopy`, `MigentPage`, `MigentForm`, `MigentAgentForm` and `MigentDraftPage` that they
  define.
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
(`copy.file`), the unavailable-session message, `Unsaved changes`, `Details`, `Loading the workflow…` and the name of
a remove button (`copy.remove(item, number)`).

- Put a string in `copy.js` when a second page needs it; a string only one page shows stays in that page's file.
- Group by meaning, not by page (`copy.menu.reloadFromDisk`, not `copy.workflowEditor.reload`). Text with a value in
  it is a function (`copy.remove('stage', 2)`), never a concatenation at the call site.
- A string a test asserts is read from `MigentCopy` too, so a wording change does not break a test.

`media/workfloweditor/workflowCopy.js` defines `MigentWorkflowCopy`: every label, hint, placeholder, note and message of
the workflow form (`workflowForm.js` reads it as `text`), grouped by what the text is about (`basics`, `stages`,
`identity`, `inlineAgent`, `dependencies`, `decisions`, `advanced`, `artifacts`, `downstream`). It loads before
`workflowForm.js`, on both places that use the form (the workflow editor and the Session page's Workflow tab).
A test checks that every key the form reads exists. Text the form shares with other pages stays in `MigentCopy`.

`media/shared/utils.js` defines `MigentUtils`: pure helpers more than one script needs, such as
`plural(count, noun)`. It loads first, so the copy files can use it.

The Session page keeps one copy file per part, in `media/session/`, each loaded before the script that reads it as
`text`: `sessionCopy.js` (`MigentSessionCopy`, the shell: menu items and batch selector), `resultsCopy.js`
(`MigentSessionResultsCopy`), `metricsCopy.js` (`MigentSessionMetricsCopy`), `sessionWorkflowCopy.js`
(`MigentSessionWorkflowCopy`, the notices around the form) and `questionsCopy.js` (`MigentSessionQuestionsCopy`).
A test checks that every key a script reads exists in its copy file.

## Shared page script

`media/shared/page.js` defines `MigentPage`:

| Member | Use |
| :--- | :--- |
| `el(tag, text, className)` | Create an element; `text` goes in with `textContent` |
| `section(title, className)` | A `<section>` with an `<h2>` |
| `connect({ render })` | Own the VS Code API handle, the revision guard on the message's top-level `revision`, `setState` and the `ready` handshake. Calls `render(model, transient)`, where `transient` is the message's optional host state (undefined when the host posts none) and never part of the model. Returns `{ send, post }`; `send(intent)` adds `type: 'intent'` and the current revision. `post(message)` sends a page-typed message unchanged, for a page whose host validates its own message set. It adds no revision and the host still validates every field |
| `details(key, summary, className, isOpenByDefault)` | The shared collapsible: a `<details>` whose open state survives a model re-render, keyed by `key` and held in memory only. It draws the chevron in `.mg-details-arrow`, so a header with chips or a wrapped title stays aligned, and puts `summary` (a string or a node) in `.mg-details-heading`. It starts closed unless `isOpenByDefault` is true and the reader has not toggled it |
| `openAround(node)` | Opens every `details` around a control, so a control inside a closed card can be focused or scrolled to. A page calls it before it focuses the control a repaint names |
| `menuButton({ label, ariaLabel, items })` | A menu button; `items` is a list of `{ label, onSelect }` |
| `pageTabs({ label, tabs, current })` | The `mg-tabs` nav of `mg-tab` buttons (`aria-current` on the current one); `tabs` is `[{ key, label, onSelect, disabled, title }]`. The session header, the Workflow editor and Configuration use it |
| Tooltip (`data-tip`) | An element with a `data-tip` attribute shows one shared tooltip on hover and on keyboard focus (Escape, scroll or a click hides it). The native `title` tooltip does not reliably show in a webview, so a hint icon, a `button` with `title` and an icon-only remove button set `data-tip` and never `title`. The tooltip is fixed to the viewport, so a card's `overflow: clip` cannot cut it off |

A model update rebuilds the page. State that must survive it (open `details`) is kept by the helper; an open menu
closes on re-render.

## Shared form kit

`media/shared/form.js` defines `MigentForm`, the control set a form-like page shares:

| Member | Use |
| :--- | :--- |
| `text`, `number`, `textarea`, `select`, `picker`, `datalist` | A control with `value`, an optional `path` (written to `data-path`), `disabled`, `placeholder` and `onInput` (a `picker` calls `onPick`). A `select` keeps a value its choices do not know, so an imported value is never rewritten. A `picker` looks like a select and asks the page to open its own list. An empty `number` reports `null` |
| `field({ label, control, path, hint, hintWarning, issue, wide, action })` | A label, the control and an issue message. A hint is the label itself: dotted underline, the tooltip on hover and keyboard focus, a hidden text node for `aria-describedby`; the issue sets `aria-invalid`. `action` is a node at the far end of the label row, for a control or state that belongs to the field but not to its value, such as the Override toggle of a Local settings unit or the "Overridden" tag of a Project one |
| `grid(children)` | A field grid that reflows from one to several columns; a `wide` field spans every column |
| `group(title, note, { actions, card, accent, children })` | A section nested inside another one: an `h3` title, a note line and trailing actions; `card` makes it one bordered repeated item, such as an output or a decision route |
| `section(title, { level, variant, accent, surface, count, note, actions, children })` | A section: a `.mg-section-head` band with the title, count chip, note and trailing actions, then a `.mg-section-body` that holds `children`. `level: 3` is a nested title, `variant` (`group` or `card`) selects the surface, and `surface` puts a page section's body on a card |
| `fieldset(legend, children, { path, hint, hintWarning, issue, action })` | A control group with a legend, an optional hint on the legend text, an action at the far end of the legend row and, for a group without one input, its issue |
| `button(label, { kind, onClick, disabled })` | A button in a kit style. A hint has no function of its own: `field` and `fieldset` mark their label with it |
| `checkboxList({ items, selected, path, onChange, onEdit, onRestructure })` | Checkboxes; an unknown item carries `unknown` and uses the warning tone |
| `stringList({ values, ... })`, `pairList({ pairs, ... })` | Add and remove rows; they mutate the draft in place, report a value change through the form `root`, and call `onEdit` and then `onRestructure(path)` after add or remove |
| `root(children, { onEdit })` | The form's root node. One delegated `input` and `change` listener reports every value edit inside it through `onEdit`, so a control never has to call it; it lays out as its children (`display: contents`) |
| `saveFooter(options, into)`, `notices(children)` | The sticky save footer (`mg-footer mg-save-footer`): save state on the left, Discard and Save on the right. `options` are `stateLabel` (empty shows nothing), `saving` (Save reads Saving…), `busy`, `canDiscard`, `canSave`, `onDiscard`, `onSave`; pass the earlier footer as `into` to refill it in place. `notices` is the `mg-notices` area under the page header that holds banners and `mg-issue-list` lists |
| `collapsibleCard({ key, number, title, summary, alerts, warn, open, tools, body })` | A card on `details` (`mg-collapsible`): a header with a number badge, the title, one quiet `summary` line, `alerts` and, at its right, `tools` (icon buttons in `mg-collapsible-tools`: move and remove), then the body in `mg-collapsible-body`. The header is a three-column grid (badge, content, tools) whose first line is as high as a tool: the chevron, the number, the title and the tools share one middle line at any width, and the tools stay at the right edge. The header is one line: the title, its warning chips, then the summary (strings joined by a middle dot, most useful first, muted, no frame). The title is never cut, and the summary is what gives way: it takes the room left beside the title and is cut with an ellipsis, and only when a chip or a short summary has no room at all does it wrap under the title, so nothing runs into the tools. The tooltip of the cell carries the title and the whole summary. A summary names only what tells items apart: a stage shows its role, an agent that is not the role's own, what it needs and its decision count, not the instruction count nor the default role agent. The tools are also reachable while the card is closed: moving a stage keeps the focus on the pressed button and removing one focuses its neighbour's header, neither opens a card (`openAround` leaves a card whose own header holds the focused control closed). `alerts` are warning chips (a problem count, a duplicate id), the only framed items in a header, so a problem is what stands out. Every item card keeps its actions in the header, never in the body. The tools show only while the pointer is over the card or focus is inside it (they keep their space and stay in the tab order); without hover, on touch, they are always visible. A card given `describe` (a function returning its current `title`, `summary`, `alerts` and `warn`) exposes `refresh()`, which redraws the header; the form calls it after every value edit, so a header never lags behind the controls in its body. The body is spaced like a section body: its blocks keep the block gap. It stays open or closed across repaints by `key` |
| `addButton`, `removeButton`, `iconButton` | A compact add action with a plus icon, a trash-icon remove action and a quiet icon-only action such as move up or down; an icon button shows no text, so it names its row in `aria-label` and tooltip |

A form page renders its controls inside `root`. `root` is the only place a value edit becomes an `onEdit` call: a page
callback just writes the new value into the draft, and `onEdit` then marks the page dirty and refreshes what depends on
it, such as a Save button. Add, remove and pick actions are clicks, not value edits; they call `onEdit` themselves, or
rebuild through `onRestructure`.

## Shared agent form and draft page

`media/shared/agentform.js` defines `MigentAgentForm`, the agent controls the workflow form and Configuration page share:
`inlineEditor` (model picker, effort and client options over the flat shape
`{ model, effort, clientType, clientOptions }`), `selector` (the "named or inline" select, given the modes a page
allows), `namedOptions`, `datalists` and the client-list helpers (`isKnownModel`, `agentModelLabel`,
`optionKeySuggestions`). Its text is `MigentCopy.agent`.

`media/shared/draftpage.js` defines `MigentDraftPage`, the draft handling the form pages share: `createUnit` (the
draft, the last adopted form, `isDirty`, `adopt(form, keepDraft)`, `discard`, and the `submitted` marker that keeps
edits made while a save is in flight), `createPicker` (routes one pending `pickModel` to its `modelPicked` reply) and
`createChrome` (the notices area and sticky footer, refreshed in place after an edit). Whether a dirty draft survives
a disk refresh is the page's policy, passed as `keepDraft`: the Workflow editor keeps it only while the file's hash is
unchanged, the Session page's Workflow tab keeps edits made after the submit, and the Configuration page keeps a dirty
tab and its save base.

A form page keeps its own data shape, validation and repaint. The kit reads no model. The Workflow editor is its
first consumer; another page adopts it by loading `form.js` and passing the draft it already owns.

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
| State badge (`mg-status`) | The state's icon, the same as the Sessions view (`DISPLAY_STATE_ICONS`): `sync` running, `comment-discussion` question, `warning` blocked, `error` failed, `pass` completed, `debug-pause` stopped, `circle-slash` cancelled, `circle` prepared, `question` unknown. A page with its own states (Questions, Next step) picks from the same set | Tone of the state: blue running, yellow question and blocked, red failed, green completed, neutral otherwise |
| Session fact chip | `milestone` stage, `watch` duration, `history` time since the last update, `comment-discussion` pending questions | Text color; pending questions in the warning tone |
| Page progress | `checklist` answered count (Questions) | Text color |
| Form hint | None: the label carries a dotted underline and the tooltip | The label's own color; the warning tone for a value that needs a change |
| Editor tab | One per page, in `media/tab-icons`: `comment-discussion` Questions, `package` Results, `graph` Metrics | The session state's tone, as in the badge and the Sessions view (`stateTone`). A tab takes an image, so there is a file per page, tone and theme, and the host swaps it when the state changes. These files are the only fixed colors, because an image cannot read theme variables; see the table below |

Tab icon files are filled with fixed colors, one per tone and theme, taken from the VS Code default dark and light
themes. They do not follow a custom theme, so keep them in step with the tone tokens when a source color changes.

| Tone | Dark | Light | Matches |
| :--- | :--- | :--- | :--- |
| `ok` | `#73C991` | `#388A34` | `--mg-ok` |
| `warn` | `#CCA700` | `#855F00` | `--mg-warn` |
| `error` | `#F88070` | `#A1260D` | `--mg-error` |
| `info` | `#3794FF` | `#1A85FF` | `--mg-info` |
| `muted` | `#C5C5C5` | `#424242` | `--mg-muted` |

`media/shared/icons.js` holds the SVG paths (`window.MigentIcons`) and `MigentPage.icon(name)` draws one in the
current text color. To add an icon, copy it from codicons (CC BY 4.0; keep the header of `icons.js`) and use its
codicon id. A test checks that the badge icons match `DISPLAY_STATE_ICONS`.

## Components

| Component | Classes | Use |
| :--- | :--- | :--- |
| Page header | `mg-header`, `mg-title`, `mg-subtitle`, `mg-actions` | Status, title, one-line subtitle and the page's actions. The Session page renders `sessionHeader` once above all its tabs, in four tiers: status badge and workflow id; the title (two lines at most, full text in its tooltip); the session's facts (the same on every page and in a fixed order: stage, duration, time since the last update, pending questions; each hidden when unknown, the duration running to now while the session runs, and both clocks refreshing every 30 seconds); and one row with the `mg-tab` page switches (Questions once questions have been pending or shown, then Results, Metrics and Workflow; the current one is underlined, with `aria-current`) followed directly by the borderless more menu (View log, Copy session ID, Reveal in Explorer, and Complete session… only when the host sets `meta.canComplete`, which excludes running, prepared, completed and role sessions). Tabs are a list, so a page is added with one entry |
| Alert | `mg-alert` with `mg-warn` / `mg-error` | A problem or explanation that stays visible, wrapped inside the page width |
| Banner | `mg-banner` with `mg-banner--ok` / `--warn` / `--error` (info otherwise), an `mg-banner__icon` and one paragraph per message | A message about the page or the session that deserves a block of its own: an icon and a left edge in the tone of the message. The Metrics and Questions tabs use it |
| Text field | `mg-input`, `mg-textarea`, `mg-select`, `mg-picker` | A single-line input, a text area, a select or a picker; the select and the picker use the dropdown colors |
| Form field | `mg-field`, `mg-field-head`, `mg-label`, `mg-has-hint`, `mg-issue`, `mg-field-grid`, `mg-field--wide` | One labelled control with a hint on its label and an issue message, in a grid that reflows; a wide field spans every column |
| Field group | `mg-section--group`, `mg-fieldset`, `mg-legend` | A named group of controls inside a stage: a section with an uppercase `h3`, a note line and optional trailing actions |
| Section head | `mg-section-head`, `mg-section-title`, `mg-section-note`, `mg-section-actions` | A sticky band with the title, count chip, note and trailing actions; it stays at the top while its section scrolls, so a long page always names the block in view. A nested section keeps its head inline. The first block under a head takes no margin of its own, so every section opens with the same gap |
| Section body | `mg-section-body` | The content area under a section head; `mg-section--surface` puts it on a card |
| Section card | `mg-section--card`, `mg-section--accent` | One repeated item such as a decision route or an output: a bordered section whose head names it and carries its remove action |
| Checkbox list | `mg-checks`, `mg-check` | A wrapped list of checkboxes; `mg-check--unknown` marks an imported value the page does not know |
| Badge and chip | `mg-badge`, `mg-chip` with `--info` / `--warn` | A number that anchors a stage, or a short quiet value such as a role, an agent kind or a count |
| Section add action | `mg-add-block` (`addBlockButton`) | The add action of a whole section list (stages, artifacts, suggestions): a full-width button with a dashed outline and a plus icon, as the last child of the section body, not in its head, so it is a large target where the new item appears. An empty list passes `empty`: one dashed frame holds the message and, under it, the button without an outline, so the dashed outline always means "click to add" |
| Row action | `mg-inline-row`, `mg-btn--danger`, `mg-add` | One editable row with a trash-icon remove action, then a compact add action (plus icon, muted at rest and in the link color on hover or keyboard focus, so it stays below the dashed section add button). A danger button is muted at rest and takes the error tone and frame only on hover or keyboard focus, so a list of rows is not a wall of red |
| Empty block | `mg-empty` | A dashed block that states what is missing instead of leaving a blank area |
| Action footer | `mg-footer` | Sticky bar of buttons that wraps at narrow widths and takes its own space, so it never covers content |
| Status indicator | `mg-status`, `mg-status--ok` / `--warn` / `--error` | The state of the thing the page describes. Always an icon plus text plus color |
| Buttons | `mg-btn` with `--primary`, `--secondary`, `--quiet`, `--link`, `--danger` | One primary action per page. Secondary for other actions. Quiet for a minor tool; an icon-only one such as move up or down uses `iconButton`. Link for an inline reference. Danger for every action that removes or discards something: it takes the error tone and is quiet until hover, so a list of rows is not a wall of red. A remove action is an icon-only trash button (`mg-btn--icon`, square) whose `aria-label` and tooltip name the row, so it stays compact in a card head or an editable row. A `disabled` button is dimmed |
| Button size | `mg-btn`, `mg-btn--sm`, `--mg-btn-height` | Two sizes: standard (28px, 4px and 12px padding) and compact (`--sm`, 24px, 2px and 8px). Use compact for an action inside a row or a tool strip; a quiet or danger button is compact by default and `button(label, { size })` overrides it. A bordered button never sets its own padding or height |
| Menu button | `mg-menu`, `mg-menu-list`, `mg-menu-item` | Less common actions; built with `menuButton` |
| List row | `mg-list`, `mg-row`, `mg-row-main`, `mg-row-meta` | One item with a label and trailing metadata. A `<button>` row is clickable; a `<div>` row is not |
| Card | `mg-card`, `mg-card-title`, `mg-card-body`, `mg-tags` | A whole-card action with a short summary. Never put another control inside it. A group that holds controls is not a card |
| Pill | `mg-pill` | A short value such as a state or an artifact name. It labels; it does not act |
| Details | `mg-details`, `mg-details-summary`, `mg-details-arrow`, `mg-details-heading` | One shared collapsible: a chevron in its own box, then the header. Secondary information and secondary actions, closed by default. Built with `details` |
| Section | `mg-section` | A titled block of the page: one `mg-section-head` and one `mg-section-body`; a nested block adds `mg-section--group` or `mg-section--card` |

Choose by purpose: a **row** lists many similar items, a **card** offers an action with context, a **pill** tags,
the **status indicator** reports state, and **details** hold what a reader needs only sometimes. A problem the reader
must notice (a warning, an error, a reload action) stays visible outside any details control.

Inside a form, a **section** is a page region with one head and one body, a **group** is a named section inside a
stage, and a **field** is one labelled control. A repeated item is a card section of its own. Every block uses the
same head and body, built with the shared form kit rather than page-local markup.

A bar (`<progress>`) is decorative: it uses `--mg-bar`, is hidden from assistive technology and always sits beside its
numeric value, so a value is never conveyed by length or color alone. Size a bar through properties (`max`, `value`),
never an inline `style` attribute.

## Visual hierarchy

Every block in a form is one of these levels, and each level has one look, so depth reads at a glance. Pages never
restyle a level; they choose it.

| Level | Component | Look |
| :--- | :--- | :--- |
| 1 | Section (`mg-section`) | Large semibold title (1.3em) on a sticky head, marked by a 3 px bar in `--mg-focus` on the left of its line, so a section is found at a glance while scrolling; its body sits on a surface |
| 2 | Repeated item: `mg-collapsible` or section card | Bordered card on `--mg-surface`; its head is a band on `--mg-surface-2` with a title-case title (1em, semibold, full text color) and the item's actions |
| 3 | Group (`mg-section--group`) | Bold uppercase title in full text color over a one-pixel rule |
| 4 | List legend (`mg-list-editor > mg-legend`) | A list's name above its rows: 0.9em, semibold, full text color, with its count chip, on a 2 px left rule in `--mg-border` that the rows hang from. It reads above the labels inside it and below a card title |
| 5 | Field label (`mg-label`, `mg-legend`) | Small (0.85em), medium weight, normal case, in `--mg-label`: a step quieter than the text, so it recedes from the value it names |

- Titles weaken one level at a time: a group title never reads quieter than the field labels it holds, and a card
  title never shares the group style.
- Only a repeated item is a card. A named block of controls is a group.
- `mg-collapsible` and `mg-section--card` are one card: the same frame, surface and head band. The collapsible is the
  one that opens and closes; use it for an item with a lot inside, and a section card for a small one.
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
| `--mg-gap-block` | Two blocks in one body (a field grid and a list). A stack outside a section body adds `mg-stack` | 16 px |
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

The shared script keeps `--mg-footer-height` equal to the height of a sticky `mg-footer`, and `base.css` uses it as
`scroll-padding-bottom`, so a focused control or a scroll target stops above the footer even when its buttons wrap.

Check a UI change by hand: Tab order, the menu keyboard behavior, `<details>` with Enter and Space, and all four
themes. Automated tests drive the shared `connect`, the Session page's Questions and Workflow tabs, the shared form
kit and the workflow form
against a small fake DOM ([pageScript.test.ts](../src/vscode/webview/pageScript.test.ts),
[questionsPage.test.ts](../src/vscode/webview/questionsPage.test.ts),
[sessionWorkflowPage.test.ts](../src/vscode/webview/sessionWorkflowPage.test.ts),
[workflowForm.test.ts](../src/vscode/webview/workflowForm.test.ts)); they do not check layout or themes, so record
the manual pass in the pull request.

## Add a page

1. Create `media/<page>/` with a stylesheet for layout only and a script that calls `MigentPage.connect` once. Take
   shared text from `MigentCopy`.
2. Describe the page with a `PageDescriptor` and use `renderPage` for the HTML and `pageResourceRoots` for
   `localResourceRoots`, both for a new panel and when restoring one.
3. Define the model in `src/core` as inert JSON and validate every message in `src/core` before the host acts on it.
4. Reuse the components above and the shared form kit. Add a new component to `base.css` or `form.js` only when two
   pages need it, and document it here.
5. Add the manual checks above to the pull request.

## Pages on the foundation

| Page | Assets | Notes |
| :--- | :--- | :--- |
| Session | [media/session](../media/session) | One page for a session: a shared header (`session.js`) and four tab renderers, `results.js`, `metrics.js`, `workflow.js` and `questions.js`, each exposing `render(container, model, page)`; `session.css` holds the page-local styles. The shell renders the header and the body of the tab the host last posted, plus the batch chip row; the Questions tab keeps one mount for the life of the page so a background update keeps its draft, focus and caret, and the other tabs are redrawn on every model. **Results**: header actions, outputs, next-step suggestions, child sessions. **Metrics**: read-only metrics of one completed session: partial-cost warning, summary, stages, usage, executions (one expandable row each, the last open), details; `missing`, `invalid` and `unreadable` files get an explanation instead of zeros, and a skipped execution shows its reason and no token or cost story. **Workflow**: the session's `workflow.yaml` in the shared workflow form (`workflowCopy.js`, `workflowModel.js`, `workflowForm.js` and `workflowForm.css`, loaded through the descriptor's `modules`); every field is disabled once any stage has an execution (`model.isLocked`), and before that Save workflow writes the draft with `migent workflow save --session` (disabled when unchanged or invalid; Discard restores the saved form). **Questions**: answer one batch, with the chip row to pick another when several are pending; above the questions, while the batch can be answered, a sticky strip of jump chips (the number, then a check once answered, the one in view marked, the question as tooltip); the state message and block reason as one `mg-banner` whose tone follows the batch state (green once the answers are recorded, yellow or red when it needs attention; none while sending); one card per question (eyebrow with the selection mode and an Answered chip, the question as a heading, context as a quote) whose options are whole rows (a visually hidden native radio or checkbox, with the letter badge as its marker, then label, description and Recommended pill), and an Other row that is one more choice and opens a focused text area; ambiguity warnings and recorded answers; a read-only previous draft in details; and a sticky `mg-footer` with Discard draft and Send answers (showing how many answers are left, and a disabled spinning Sending… in its place while the send is in flight), or the state's recovery action (Load the new questions, Check again, Continue the stage) when it is not Answering. Once the answers are recorded the strip and the footer are gone and each card is a read-only record of its answer. Only the principal action of the state is primary. Question cards, option rows and the recorded block are page-local styles |
| Next step | [media/nextstep](../media/nextstep) | Edit the task and launch a suggested workflow: header with a launch status (Ready, Starting, Blocked), alerts for the launch blocker and the last error (always visible), task field, context rows, target workflow with Recheck, child sessions, and a sticky footer with Back, Prepare and Run. It reads the host's `transient` state (`pending`, `error`) through `connect`. Only the task field and the footer are page-local styles. A re-render keeps the task text, focus and selection while the field has focus |
| Workflow editor | [media/workfloweditor](../media/workfloweditor) | Edits one schema 5 workflow file: header, Design form, CLI diagnostics and a sticky Save/Discard footer; the YAML tab opens the file in the editor. A stage picks the role agent, a named agent from `config.yaml`, or a complete inline agent (provider, model, effort, client and client options), matching `workflow save --preserve-comments`. Save posts the form draft as YAML to `migent workflow save - --target <file> --format yaml --base-hash <sha256> --preserve-comments --json`; the host accepts only the versioned envelope, keeps the draft on an invalid result or a stale base, shows each diagnostic, and clears diagnostics when the draft changes. Other schema versions stay read-only with a migrate hint. The Design controls are a reusable module, `workflowForm.js` with its layout stylesheet `workflowForm.css` (`MigentWorkflowForm`; the data shape, the pure draft operations such as `moveStage`, `removeStage` and `renameStageReferences`, and the option-list builders live in `workflowModel.js` (`MigentWorkflowModel`), which builds no DOM and loads before the form; the save footer and notices come from the form kit): `create({ getModel, getForm, issues, onEdit, repaint, pickModel })` renders the form over a draft the host page owns; `emptyForm` and `normalizeForm` define its data shape. Each stage, artifact and downstream suggestion is a kit `collapsibleCard`, closed by default: a stage's header carries its number and id, then a summary of role, a non-default agent, what it needs and its decision count, an artifact's its id, file and whether it is required, and a suggestion's its workflow, task and mapping; each shows a problem chip when an error is inside it. A card that holds the control being focused (a new item, or an issue the reader is taken to) opens first. Inside, the settings are grouped as Identity, Inline agent (only for an inline agent), Dependencies, Instructions, Decisions and an Advanced details block, so a stage reads top to bottom without repeating legends. Section heads are sticky bands that owe their separation to a surface, not to a divider; a decision route is a shared panel with its own remove action. Only controls carry a hint icon. The controls and their layout come from the shared form kit. Reference fields are closed lists: role and named agent from `config.yaml`, downstream workflow from the project's other workflow files, output source and artifact from the chosen stage, resumed session from the stage's dependencies, and decision destinations from the draft's other stages plus `complete`, one per decision and never the stage itself, while an imported route to several stages or to its own stage stays visible with a warning; a value the list does not know stays visible so an imported file is never silently rewritten. An inline agent's Model is one picker over the same searchable, provider-grouped list as initialization; it writes the provider and model together. Effort stays beside it, and client options follow the pair. An imported provider, model or client value is kept and shown on the picker; a pair the list does not cover is changed in the workflow file. Option keys come from `migent get options --client <id> --native` and models from `get models --client <id>`, for each client in `get clients`, read once per project and refreshed by Reload, and effort uses the values the Migent CLI documents. The page asks the host with a `pickModel` message and applies the `modelPicked` choice to its own draft, so every other edit stays in place. It loads after `form.js` and before the page script |
| Configuration | [media/config](../media/config) | Edits `.migent/config.yaml` (Project) and `.migent/config.local.yaml` (Local) as Agents and Roles sections of collapsible cards (`config.js` the shell, `configform.js` `MigentConfigForm`, `configcopy.js`); the YAML tab opens the active file. Each tab has its own draft, dirty state and save intent (replace with the hash it was read at, or create when started from a missing file). On Local every setting the CLI merges on its own (an agent's model, effort, client type and each client option, a role's description, its responsibilities and its whole agent) has an Override toggle at the end of the field's label row; absent inherits `config.yaml` and present (even empty) overrides it, and while a unit is inherited its control stays in place but disabled, holding the value from `config.yaml`. On Project each such unit that the saved `config.local.yaml` sets carries an "Overridden" tag in the warning tone at the far end of its label row, with a warning icon and a tooltip explaining that `config.local.yaml` sets it, so the field shows both its own value and that it is overridden. A clean tab adopts a changed file; a dirty tab keeps its draft and shows a changed-on-disk notice with Reload. A diagnostic from the other file is labelled with that file |

## Questions message contract

The Session page's Questions tab keeps its own message set because its host validates edits against a generation and a fingerprint.

- **Model.** The host posts `{ type: 'model', revision, identity, model }` where `model` is the Session page model and
  the batch's answer model is `model.questions.model`. The top-level `revision` counts the panel's posts and is what
  `connect` guards on (a message without it is ignored); the answer model carries its own `revision`, which `submit`
  echoes.
- **Page messages.** The page sends `edit`, `submit`, `reload`, `discard`, `recheck`, `continue`, `viewLog`,
  `openQuestions` and `later` with `post`, and `openResults` and `openMetrics` to switch tab. `parseSessionPageMessage`
  in `src/core/sessionPageIntent.ts` routes them to `parseAnswerMessage` in `src/core/answerModel.ts`, which validates
  them; `edit` carries the generation and fingerprint, `submit` the revision and fingerprint, and the host drops a
  stale one.
- **Drafts.** A model with the same generation and fingerprint as the shown one keeps the local draft over the host's
  echo; a new generation or fingerprint replaces it. A re-render keeps focus, text selection, scroll and expanded
  context. Ctrl or Cmd with Enter sends only when the Send answers button would be enabled.
