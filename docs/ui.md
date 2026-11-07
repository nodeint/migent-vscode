# Webview UI

This page defines how Migent webview pages are built: the shared page foundation, the design vocabulary and the
rules every page keeps. Every page (Results, Session Metrics, Next step, Questions and the Workflow editor) is on
the foundation.
For module ownership see [Architecture](architecture.md); for how to verify UI changes see [Testing](testing.md).

## Page architecture

A page is a webview panel whose HTML, styles and script come from `media/`. Three layers own it:

| Layer | Location | Owns |
| :--- | :--- | :--- |
| Host helper | [page.ts](../src/vscode/webview/page.ts), [pageHtml.ts](../src/vscode/webview/pageHtml.ts) | The HTML skeleton, the content security policy, the nonce, asset order and `localResourceRoots` |
| Shared assets | [media/shared](../media/shared) | Tokens and component styles (`base.css`), icons (`icons.js`), page helpers (`page.js`), the form kit (`form.js`) |
| Page assets | `media/<page>/` | Layout and rendering of one page; no tokens or component styles of its own |

A page is described by a `PageDescriptor`: its `media/` folder, its own stylesheet and script names and its title.
The helper never takes HTML fragments or user data, so a page cannot weaken the policy.

- **Policy.** `default-src 'none'; style-src <cspSource>; script-src 'nonce-<nonce>'`. A fresh nonce is generated for
  every render and set on every script. No inline script or style, no remote resource.
- **Order.** The shared stylesheet loads before the page stylesheet, and the shared scripts (`icons.js`, then
  `page.js`, then `form.js`) before the page script. The page script depends on the globals `MigentIcons`,
  `MigentPage` and `MigentForm` that they define.
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

## Shared page script

`media/shared/page.js` defines `MigentPage`:

| Member | Use |
| :--- | :--- |
| `el(tag, text, className)` | Create an element; `text` goes in with `textContent` |
| `section(title, className)` | A `<section>` with an `<h2>` |
| `connect({ render })` | Own the VS Code API handle, the revision guard on the message's top-level `revision`, `setState` and the `ready` handshake. Calls `render(model, transient)`, where `transient` is the message's optional host state (undefined when the host posts none) and never part of the model. Returns `{ send, post }`; `send(intent)` adds `type: 'intent'` and the current revision. `post(message)` sends a page-typed message unchanged, for a page whose host validates its own message set. It adds no revision and the host still validates every field |
| `details(key, summary, className, isOpenByDefault)` | The shared collapsible: a `<details>` whose open state survives a model re-render, keyed by `key` and held in memory only. It draws the chevron in `.mg-details-arrow`, so a header with chips or a wrapped title stays aligned, and puts `summary` (a string or a node) in `.mg-details-heading`. It starts closed unless `isOpenByDefault` is true and the reader has not toggled it |
| `menuButton({ label, ariaLabel, items })` | A menu button; `items` is a list of `{ label, onSelect }` |

A model update rebuilds the page. State that must survive it (open `details`) is kept by the helper; an open menu
closes on re-render.

## Shared form kit

`media/shared/form.js` defines `MigentForm`, the control set a form-like page shares:

| Member | Use |
| :--- | :--- |
| `text`, `number`, `textarea`, `select`, `picker`, `datalist` | A control with `value`, an optional `path` (written to `data-path`), `disabled`, `placeholder` and `onInput` (a `picker` calls `onPick`). A `select` keeps a value its choices do not know, so an imported value is never rewritten. A `picker` looks like a select and asks the page to open its own list. An empty `number` reports `null` |
| `field({ label, control, path, hint, hintWarning, issue, wide })` | A label with a tooltip hint icon, the control and an issue message; the issue sets `aria-invalid` and the hint and issue are linked through `aria-describedby` |
| `grid(children)` | A field grid that reflows from one to several columns; a `wide` field spans every column |
| `group(title, note, { actions, card, accent, children })` | A section nested inside another one: an `h3` title, a note line and trailing actions; `card` makes it one bordered repeated item, such as an output or a decision route |
| `section(title, { level, variant, accent, surface, count, note, actions, children })` | A section: a `.mg-section-head` band with the title, count chip, note and trailing actions, then a `.mg-section-body` that holds `children`. `level: 3` is a nested title, `variant` (`group` or `card`) selects the surface, and `surface` puts a page section's body on a card |
| `fieldset(legend, children, { path, hint, hintWarning, issue })` | A control group with a legend, an optional hint tooltip and, for a group without one input, its issue |
| `hint(text, warning)`, `button(label, { kind, onClick, disabled })` | A hint icon whose tooltip carries the text, and a button in a kit style |
| `checkboxList({ items, selected, path, onChange, onEdit, onRestructure })` | Checkboxes; an unknown item carries `unknown` and uses the warning tone |
| `stringList({ values, ... })`, `pairList({ pairs, ... })` | Add and remove rows; they mutate the draft in place and call `onEdit` after a value change and `onRestructure(path)` after add or remove |
| `addButton`, `removeButton` | A full-width add row and a quiet row action; a remove action names its row in `aria-label` |

A form page keeps its own data shape, validation and repaint. The kit reads no model. The Workflow editor is its
first consumer; another page adopts it by loading `form.js` and passing the draft it already owns.

A hint belongs to a control: `field` and `fieldset` take one and render it as a small icon with the text as its
tooltip. Layout blocks (`section`, `group`) never carry a hint; their note is a line of text.

## Tokens

`base.css` maps VS Code theme variables to `--mg-*` custom properties. Colors come only from `--vscode-*` variables,
each with a fallback; never hard-code a color.

| Token group | Source |
| :--- | :--- |
| Text: `--mg-fg`, `--mg-muted`, `--mg-link` | `foreground`, `descriptionForeground`, `textLink.foreground` |
| Tone: `--mg-ok`, `--mg-warn`, `--mg-error`, `--mg-info` | `testing.iconPassed`, `list.warningForeground`, `list.errorForeground`, `charts.blue`: the colors of the Sessions view state icons |
| Surface: `--mg-surface`, `--mg-hover`, `--mg-border` | `editorWidget.background`, `list.hoverBackground`, `panelSection.border` |
| Focus: `--mg-focus` | `focusBorder` |
| Bar: `--mg-bar` | `progressBar.background`, then `textLink.foreground` |
| Spacing: `--mg-space-1` to `--mg-space-5` | 4, 8, 12, 16 and 24 px |
| Type: `--mg-font`, `--mg-font-size`, `--mg-mono` | The editor and UI fonts |

## Icons

One vocabulary everywhere: [codicons](https://github.com/microsoft/vscode-codicons), the icons of VS Code and of the
Sessions view. Never a Unicode glyph or a page-drawn icon. The icon says *what*, the color says *state*.

| Where | Icon | Color |
| :--- | :--- | :--- |
| State badge (`mg-status`) | The state's icon, the same as the Sessions view (`DISPLAY_STATE_ICONS`): `sync` running, `comment-discussion` question, `warning` blocked, `error` failed, `pass` completed, `debug-pause` stopped, `circle-slash` cancelled, `circle` prepared, `question` unknown. A page with its own states (Questions, Next step) picks from the same set | Tone of the state: blue running, yellow question and blocked, red failed, green completed, neutral otherwise |
| Session fact chip | `milestone` stage, `watch` duration, `history` time since the last update, `comment-discussion` pending questions | Text color; pending questions in the warning tone |
| Page progress | `checklist` answered count (Questions) | Text color |
| Form hint | `question-filled` (the `question` codicon with a filled disc) | Muted; the warning tone for a value that needs a change |
| Editor tab | One per page, in `media/tab-icons`: `comment-discussion` Questions, `package` Results, `graph` Metrics | The session state's tone, as in the badge and the Sessions view (`stateTone`). A tab takes an image, so there is a file per page, tone and theme, and the host swaps it when the state changes |

`media/shared/icons.js` holds the SVG paths (`window.MigentIcons`) and `MigentPage.icon(name)` draws one in the
current text color. `question-filled` is the `question` codicon with the question mark cut out of a filled disc, so a
hint can sit on one line. To add an icon, copy it from codicons (CC BY 4.0; keep the header of `icons.js`) and use its
codicon id. A test checks that the badge icons match `DISPLAY_STATE_ICONS`.

## Components

| Component | Classes | Use |
| :--- | :--- | :--- |
| Page header | `mg-header`, `mg-title`, `mg-subtitle`, `mg-actions` | Status, title, one-line subtitle and the page's actions. Results, Session Metrics and Questions share `sessionHeader`, in four tiers: status badge and workflow id; the title (two lines at most, full text in its tooltip); the session's facts (the same on every page and in a fixed order: stage, duration, time since the last update, pending questions; each hidden when unknown, the duration running to now while the session runs, and both clocks refreshing every 30 seconds); and one row with the `mg-tab` page switches (Questions only while questions are pending, then Results and Metrics; the current one is underlined, with `aria-current`) followed directly by the borderless more menu. Tabs are a list, so a page is added with one entry |
| Alert | `mg-alert` with `mg-warn` / `mg-error` | A problem or explanation that stays visible, wrapped inside the page width |
| Banner | `mg-banner` with `mg-banner--ok` / `--warn` / `--error` (info otherwise), an `mg-banner__icon` and one paragraph per message | A message about the page or the session that deserves a block of its own: an icon and a left edge in the tone of the message. Session Metrics and Questions use it |
| Text field | `mg-input`, `mg-textarea`, `mg-select`, `mg-picker` | A single-line input, a text area, a select or a picker; the select and the picker use the dropdown colors |
| Form field | `mg-field`, `mg-field-head`, `mg-label`, `mg-hint-icon`, `mg-issue`, `mg-field-grid`, `mg-field--wide` | One labelled control with a hint tooltip icon and an issue message, in a grid that reflows; a wide field spans every column |
| Field group | `mg-section--group`, `mg-fieldset`, `mg-legend` | A named group of controls inside a stage: a section with an uppercase `h3`, a note line and optional trailing actions |
| Section head | `mg-section-head`, `mg-section-title`, `mg-section-note`, `mg-section-actions` | A sticky band with the title, count chip, note and trailing actions; it stays at the top while its section scrolls, so a long page always names the block in view. A nested section keeps its head inline |
| Section body | `mg-section-body` | The content area under a section head; `mg-section--surface` puts it on a card |
| Section card | `mg-section--card`, `mg-section--accent` | One repeated item such as a decision route or an output: a bordered section whose head names it and carries its remove action |
| Checkbox list | `mg-checks`, `mg-check` | A wrapped list of checkboxes; `mg-check--unknown` marks an imported value the page does not know |
| Badge and chip | `mg-badge`, `mg-chip` with `--info` / `--warn` | A number that anchors a stage, or a short quiet value such as a role, an agent kind or a count |
| Row action | `mg-inline-row`, `mg-btn--quiet`, `mg-add` | One editable row with a quiet remove action, then a full-width dashed add row |
| Empty block | `mg-empty` | A dashed block that states what is missing instead of leaving a blank area |
| Action footer | `mg-footer` | Sticky bar of buttons that wraps at narrow widths and takes its own space, so it never covers content |
| Status indicator | `mg-status`, `mg-status--ok` / `--warn` / `--error` | The state of the thing the page describes. Always an icon plus text plus color |
| Buttons | `mg-btn` with `--primary`, `--secondary`, `--link` | One primary action per page. Secondary for other actions. Link for an inline reference. A `disabled` button is dimmed |
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
themes. Automated tests drive the shared `connect`, the Questions page, the shared form kit and the workflow form
against a small fake DOM ([pageScript.test.ts](../src/vscode/webview/pageScript.test.ts),
[questionsPage.test.ts](../src/vscode/webview/questionsPage.test.ts),
[workflowForm.test.ts](../src/vscode/webview/workflowForm.test.ts)); they do not check layout or themes, so record
the manual pass in the pull request.

## Add a page

1. Create `media/<page>/` with a stylesheet for layout only and a script that calls `MigentPage.connect` once.
2. Describe the page with a `PageDescriptor` and use `renderPage` for the HTML and `pageResourceRoots` for
   `localResourceRoots`, both for a new panel and when restoring one.
3. Define the model in `src/core` as inert JSON and validate every message in `src/core` before the host acts on it.
4. Reuse the components above and the shared form kit. Add a new component to `base.css` or `form.js` only when two
   pages need it, and document it here.
5. Add the manual checks above to the pull request.

## Pages on the foundation

| Page | Assets | Notes |
| :--- | :--- | :--- |
| Results | [media/results](../media/results) | Header actions, outputs, next-step suggestions, child sessions |
| Session Metrics | [media/sessionmetrics](../media/sessionmetrics) | Read-only metrics of one completed session: header, partial-cost warning, summary, stages, usage, executions (one expandable row each, the last open), details. `missing`, `invalid` and `unreadable` files get an explanation instead of zeros; a skipped execution shows its reason and no token or cost story. Reached from the Results **Metrics** button and the Sessions context menu, never from the Command Palette |
| Next step | [media/nextstep](../media/nextstep) | Edit the task and launch a suggested workflow: header with a launch status (Ready, Starting, Blocked), alerts for the launch blocker and the last error (always visible), task field, context rows, target workflow with Recheck, child sessions, and a sticky footer with Back, Prepare and Run. It reads the host's `transient` state (`pending`, `error`) through `connect`. Only the task field and the footer are page-local styles. A re-render keeps the task text, focus and selection while the field has focus |
| Questions | [media/questions](../media/questions) | Answer one batch of questions: the shared session header (the session's state badge, as on every session page, workflow id, session title, Questions, Results and Metrics tabs, and, above the questions, while the batch can be answered, a sticky strip of jump chips: the number, then a check once answered, the one in view marked, the question as tooltip); the state message and block reason as one `mg-banner` whose tone follows the batch state (green once the answers are recorded, yellow or red when it needs attention; none while sending); one card per question (eyebrow with the selection mode and an Answered chip, the question as a heading, context as a quote) whose options are whole rows (a visually hidden native radio or checkbox, with the letter badge as its marker, then label, description and Recommended pill), and an Other row that is one more choice and opens a focused text area; ambiguity warnings and recorded answers; a read-only previous draft in details; and a sticky `mg-footer` with Discard draft and Send answers (showing how many answers are left, and a disabled spinning Sending… in its place while the send is in flight), or the state's recovery action (Load the new questions, Check again, Continue the stage) when it is not Answering. Once the answers are recorded the strip and the footer are gone and each card is a read-only record of its answer. Only the principal action of the state is primary. Question cards, option rows and the recorded block are page-local styles |
| Workflow editor | [media/workfloweditor](../media/workfloweditor) | Edits one schema 5 workflow file: header, Design form, CLI diagnostics and a sticky Save/Discard footer; the YAML tab opens the file in the editor. A stage picks the role agent, a named agent from `config.yaml`, or a complete inline agent (provider, model, effort, client and client options), matching `workflow save --preserve-comments`. Save posts the form draft as YAML to `migent workflow save - --target <file> --format yaml --base-hash <sha256> --preserve-comments --json`; the host accepts only the versioned envelope, keeps the draft on an invalid result or a stale base, shows each diagnostic, and clears diagnostics when the draft changes. Other schema versions stay read-only with a migrate hint. The Design controls are a reusable module, `workflowform.js` (`MigentWorkflowForm`): `create({ getModel, getForm, issues, onEdit, repaint, pickModel })` renders the form over a draft the host page owns; `emptyForm` and `normalizeForm` define its data shape. Each stage is an expandable card built on the shared collapsible, whose header carries its number, id and role, agent and instruction-count chips. Inside, the settings are grouped as Identity, Inline agent (only for an inline agent), Dependencies, Instructions, Decisions and an Advanced details block, so a stage reads top to bottom without repeating legends. Section heads are sticky bands that owe their separation to a surface, not to a divider; Outputs and Downstream render each item as a card, and a decision route is a shared panel with its own remove action. Only controls carry a hint icon. The controls and their layout come from the shared form kit. Reference fields are closed lists: role and named agent from `config.yaml`, downstream workflow from the project's other workflow files, output source and artifact from the chosen stage, resumed session from the stage's dependencies, and decision destinations from the draft's other stages plus `complete`, one per decision and never the stage itself, while an imported route to several stages or to its own stage stays visible with a warning; a value the list does not know stays visible so an imported file is never silently rewritten. An inline agent's Model is one picker over the same searchable, provider-grouped list as initialization; it writes the provider and model together. Effort stays beside it, and client options follow the pair. An imported provider, model or client value is kept and shown on the picker; a pair the list does not cover is changed in the workflow file. Option keys come from `migent get options --client <id> --native` and models from `get models --client <id>`, for each client in `get clients`, read once per project and refreshed by Reload, and effort uses the values the Migent CLI documents. The page asks the host with a `pickModel` message and applies the `modelPicked` choice to its own draft, so every other edit stays in place. It loads after `form.js` and before the page script |
| Session workflow | [media/sessionworkflow](../media/sessionworkflow) | Shows one session's `workflow.yaml` in the shared workflow form (`workflowform.js`, loaded through the descriptor's `modules`). Every field is disabled once any stage has an execution (`model.isLocked`); saving is not available yet. Opened from the Sessions context menu (`migent.session.openWorkflow`) |

## Questions message contract

Questions keeps its own message set because its host validates edits against a generation and a fingerprint.

- **Model.** The host posts `{ type: 'model', revision, identity, model }`. `revision` is the same number as
  `model.revision`; `connect` guards on the top-level one, and a message without it is ignored.
- **Page messages.** The page sends `edit`, `submit`, `reload`, `discard`, `recheck`, `continue`, `viewLog`,
  `openQuestions` and `later` with `post`. `parseAnswerMessage` in `src/core/answerModel.ts` validates them; `edit` carries
  the generation and fingerprint, `submit` the revision and fingerprint, and the host drops a stale one.
- **Drafts.** A model with the same generation and fingerprint as the shown one keeps the local draft over the host's
  echo; a new generation or fingerprint replaces it. A re-render keeps focus, text selection, scroll and expanded
  context. Ctrl or Cmd with Enter sends only when the Send answers button would be enabled.
