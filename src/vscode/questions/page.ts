import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';


const NONCE_BYTES = 16;


export function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(NONCE_BYTES).toString('base64');
  const asset = (name: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'questions', name)).toString();
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('questions.css')}">
<title>Questions</title>
</head>
<body>
<main id="root"></main>
<script nonce="${nonce}" src="${asset('questions.js')}"></script>
</body>
</html>`;
}
