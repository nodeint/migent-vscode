import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import { stateTone } from '../../core/displayState';
import { pageHtml } from './pageHtml';

const NONCE_BYTES = 16;
const SHARED_FOLDER = 'shared';
const SHARED_STYLE = 'base.css';
const SHARED_SCRIPTS = ['icons.js', 'page.js'];

/**
 * A webview page: the `media/<folder>` it lives in, its own asset file names and its title.
 * The shared stylesheet and script from `media/shared` always load first.
 */
export interface PageDescriptor {
  folder: string;
  styles: readonly string[];
  scripts: readonly string[];
  title: string;
}

/** The only folders a page may load from, derived from the descriptor so HTML and roots cannot drift apart. */
export function pageResourceRoots(extensionUri: vscode.Uri, page: PageDescriptor): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(extensionUri, 'media', SHARED_FOLDER),
    vscode.Uri.joinPath(extensionUri, 'media', page.folder),
  ];
}

/** HTML for a page with a fresh nonce. */
export function renderPage(webview: vscode.Webview, extensionUri: vscode.Uri, page: PageDescriptor): string {
  const asset = (folder: string, name: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', folder, name)).toString();
  return pageHtml({
    cspSource: webview.cspSource,
    nonce: randomBytes(NONCE_BYTES).toString('base64'),
    title: page.title,
    styles: [asset(SHARED_FOLDER, SHARED_STYLE), ...page.styles.map((name) => asset(page.folder, name))],
    scripts: [
      ...SHARED_SCRIPTS.map((name) => asset(SHARED_FOLDER, name)),
      ...page.scripts.map((name) => asset(page.folder, name)),
    ],
  });
}

/**
 * Editor-tab icon of a page (`media/tab-icons`): the page's codicon in the color of the session state, as in the
 * Sessions view. A tab takes an image, so every tone has a file per theme with the theme's icon color.
 */
export function tabIcon(
  extensionUri: vscode.Uri,
  name: 'questions' | 'results' | 'metrics',
  state: string,
): { light: vscode.Uri; dark: vscode.Uri } {
  const tone = stateTone(state);
  const icon = (theme: 'light' | 'dark'): vscode.Uri =>
    vscode.Uri.joinPath(extensionUri, 'media', 'tab-icons', `${name}-${tone}-${theme}.svg`);
  return { light: icon('light'), dark: icon('dark') };
}
