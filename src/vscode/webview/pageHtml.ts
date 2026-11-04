/**
 * Pure builder for a webview page's HTML. It knows no `vscode` API so its output can be tested.
 * It takes file URIs and a nonce, never HTML fragments or user data, so a page cannot weaken the CSP.
 */
export interface PageHtmlInput {
  /** Value of `webview.cspSource`. */
  cspSource: string;
  nonce: string;
  title: string;
  /** Stylesheet URIs in load order: shared first, then the page's. */
  styles: readonly string[];
  /** Script URIs in load order: shared first, then the page's. */
  scripts: readonly string[];
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function pageHtml(input: PageHtmlInput): string {
  const csp = `default-src 'none'; style-src ${input.cspSource}; script-src 'nonce-${input.nonce}';`;
  const styles = input.styles.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`).join('\n');
  const scripts = input.scripts
    .map((src) => `<script nonce="${input.nonce}" src="${escapeAttribute(src)}"></script>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${styles}
<title>${escapeText(input.title)}</title>
</head>
<body>
<main id="root"></main>
${scripts}
</body>
</html>`;
}
