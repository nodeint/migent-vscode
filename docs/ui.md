# Webview UI

This page defines how Migent webview pages are built: the shared page foundation, the design vocabulary and the
rules every page keeps. Results, Session Metrics and Next step are on the foundation today; see [Not shared yet](#not-shared-yet).
For module ownership see [Architecture](architecture.md); for how to verify UI changes see [Testing](testing.md).

## Page architecture

A page is a webview panel whose HTML, styles and script come from `media/`. Three layers own it:

| Layer | Location | Owns |
| :--- | :--- | :--- |
| Host helper | [page.ts](../src/vscode/webview/page.ts), [pageHtml.ts](../src/vscode/webview/pageHtml.ts) | The HTML skeleton, the content security policy, the nonce, asset order and `localResourceRoots` |
| Shared assets | [media/shared](../media/shared) | Tokens and component styles (`base.css`), page helpers (`page.js`) |
| Page assets | `media/<page>/` | Layout and rendering of one page; no tokens or component styles of its own |

A page is described by a `PageDescriptor`: its `media/` folder, its own stylesheet and script names and its title.
The helper never takes HTML fragments or user data, so a page cannot weaken the policy.

- **Policy.** `default-src 'none'; style-src <cspSource>; script-src 'nonce-<nonce>'`. A fresh nonce is generated for
  every render and set on every script. No inline script or style, no remote resource.
- **Order.** The shared stylesheet loads before the page stylesheet, and the shared script before the page script.
  The page script depends on the global `MigentPage` that the shared script defines.
- **Roots.** `localResourceRoots` is derived from the same descriptor and allows `media/shared` and the page's own
  folder only. Both folders are already packaged (`!media/**` in `.vscodeignore`); no build step is involved.
- **Model.** The host posts `{ type: 'model', revision, identity, model }`, plus an optional `transient`, only when
  the model changed and answers the page's `ready` message with the current one. The page ignores a revision it
  has already shown and records `identity` with `setState` so a serializer can restore the panel.
- **Intents.** The page sends `{ type: 'intent', intent, ... }` with identity only: a key, a name, a session id or a
  member of a closed action set. The host validates the shape in `src/core`, revalidates against fresh data and
  resolves any path or command itself. A page never sends a path, a command id or argv.
- **Text.** Every string is set with `textContent`. Never use `innerHTML` or `insertAdjacentHTML`. Long text is
  shortened by CSS only; the full text stays in the DOM and in a `title` tooltip set as a property.

## Shared page script

`media/shared/page.js` defines `MigentPage`:

| Member | Use |
| :--- | :--- |
| `el(tag, text, className)` | Create an element; `text` goes in with `textContent` |
| `section(title, className)` | A `<section>` with an `<h2>` |
| `connect({ render })` | Own the VS Code API handle, the revision guard, `setState` and the `ready` handshake. Calls `render(model, transient)`, where `transient` is the message's optional host state (undefined when the host posts none) and never part of the model. Returns `{ send }`; `send(intent)` adds the current revision |
| `details(key, summary, className, isOpenByDefault)` | A `<details>` whose open state survives a model re-render, keyed by `key` and held in memory only. It starts closed unless `isOpenByDefault` is true and the reader has not toggled it |
| `menuButton({ label, ariaLabel, items })` | A menu button; `items` is a list of `{ label, onSelect }` |

A model update rebuilds the page. State that must survive it (open `details`) is kept by the helper; an open menu
closes on re-render.

## Tokens

`base.css` maps VS Code theme variables to `--mg-*` custom properties. Colors come only from `--vscode-*` variables,
each with a fallback; never hard-code a color.

| Token group | Source |
| :--- | :--- |
| Text: `--mg-fg`, `--mg-muted`, `--mg-link` | `foreground`, `descriptionForeground`, `textLink.foreground` |
| Tone: `--mg-ok`, `--mg-warn`, `--mg-error`, `--mg-info` | `testing.iconPassed`, `editorWarning.foreground`, `errorForeground`, `descriptionForeground` |
| Surface: `--mg-surface`, `--mg-hover`, `--mg-border` | `editorWidget.background`, `list.hoverBackground`, `panelSection.border` |
| Focus: `--mg-focus` | `focusBorder` |
| Bar: `--mg-bar` | `progressBar.background`, then `textLink.foreground` |
| Spacing: `--mg-space-1` to `--mg-space-5` | 4, 8, 12, 16 and 24 px |
| Type: `--mg-font`, `--mg-font-size`, `--mg-mono` | The editor and UI fonts |

## Components

| Component | Classes | Use |
| :--- | :--- | :--- |
| Page header | `mg-header`, `mg-title`, `mg-subtitle`, `mg-actions` | Status, title, one-line subtitle and the page's actions |
| Status indicator | `mg-status`, `mg-status--ok` / `--warn` / `--error` | The state of the thing the page describes. Always an icon plus text plus color |
| Buttons | `mg-btn` with `--primary`, `--secondary`, `--link` | One primary action per page. Secondary for other actions. Link for an inline reference. A `disabled` button is dimmed |
| Menu button | `mg-menu`, `mg-menu-list`, `mg-menu-item` | Less common actions; built with `menuButton` |
| List row | `mg-list`, `mg-row`, `mg-row-main`, `mg-row-meta` | One item with a label and trailing metadata. A `<button>` row is clickable; a `<div>` row is not |
| Card | `mg-card`, `mg-card-title`, `mg-card-body`, `mg-tags` | A whole-card action with a short summary. Never put another control inside it |
| Pill | `mg-pill` | A short value such as a state or an artifact name. It labels; it does not act |
| Details | `mg-details` | Secondary information and secondary actions, closed by default |
| Section | `mg-section` | A titled block of the page |

Choose by purpose: a **row** lists many similar items, a **card** offers an action with context, a **pill** tags,
the **status indicator** reports state, and **details** hold what a reader needs only sometimes. A problem the reader
must notice (a warning, an error, a reload action) stays visible outside any details control.

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

Check a UI change by hand: Tab order, the menu keyboard behavior, `<details>` with Enter and Space, and all four
themes. The page script is not driven by automated tests; record the manual pass in the pull request.

## Add a page

1. Create `media/<page>/` with a stylesheet for layout only and a script that calls `MigentPage.connect` once.
2. Describe the page with a `PageDescriptor` and use `renderPage` for the HTML and `pageResourceRoots` for
   `localResourceRoots`, both for a new panel and when restoring one.
3. Define the model in `src/core` as inert JSON and validate every message in `src/core` before the host acts on it.
4. Reuse the components above. Add a new component to `base.css` only when two pages need it, and document it here.
5. Add the manual checks above to the pull request.

## Pages on the foundation

| Page | Assets | Notes |
| :--- | :--- | :--- |
| Results | [media/results](../media/results) | Header actions, outputs, next-step suggestions, child sessions |
| Session Metrics | [media/sessionmetrics](../media/sessionmetrics) | Read-only metrics of one completed session: header, partial-cost warning, summary, stages, usage, executions (one expandable row each, the last open), details. `missing`, `invalid` and `unreadable` files get an explanation instead of zeros; a skipped execution shows its reason and no token or cost story. Reached from the Results **Metrics** button and the Sessions context menu, never from the Command Palette |
| Next step | [media/nextstep](../media/nextstep) | Edit the task and launch a suggested workflow: header with a launch status (Ready, Starting, Blocked), alerts for the launch blocker and the last error (always visible), task field, context rows, target workflow with Recheck, child sessions, and a sticky footer with Back, Prepare and Run. It reads the host's `transient` state (`pending`, `error`) through `connect`. Only the task field and the footer are page-local styles. A re-render keeps the task text, focus and selection while the field has focus |

## Not shared yet

Questions ([media/questions](../media/questions), [page.ts](../src/vscode/questions/page.ts)) keeps its own `html()`,
stylesheet and script. To migrate it, switch its `html()` and `localResourceRoots` to the helper, replace the
duplicated scaffold in its script with `MigentPage`, move repeated rules to the shared components, and re-check its
forms, drafts and footer by hand. The text field and sticky action footer that Next step styles in its own
stylesheet are the first candidates to share once Questions migrates, since a component needs two pages.
