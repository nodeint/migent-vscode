import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

/**
 * The catalog rules of `eslint.config.mjs`, run through ESLint's Node API with the repository config on snippets.
 * A snippet is linted as a file at a given path, so the file-set scoping of the rules is exercised too.
 */
const ROOT = path.resolve(__dirname, '..', '..');
// The rules under test are syntactic. A snippet is not a file of the TypeScript project, so type information is
// switched off for it; everything else (the files, ignores and rule lists) is the repository config.
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: [
    tseslint.configs.disableTypeChecked,
    { languageOptions: { parserOptions: { projectService: false } } },
  ],
});

async function messages(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const HOST = 'src/vscode/example.ts';
const CATALOG_MESSAGE = 'Host-written UI text belongs in the catalog in src/text/';

describe('UI text rule', () => {
  const flagged: [string, string][] = [
    ['setStatusBarMessage', "vscode.window.setStatusBarMessage('Hello there', 1);"],
    ['setStatusBarMessage template', 'vscode.window.setStatusBarMessage(`Hello ${name}`, 1);'],
    ['createOutputChannel', "vscode.window.createOutputChannel('Migent', { log: true });"],
    ['appendLine', "output.appendLine('doctor');"],
    ['createWebviewPanel title', "vscode.window.createWebviewPanel('type', 'Session', 1, {});"],
    ['TreeItem label', "new vscode.TreeItem('Files', 1);"],
    ['FileSystemError', "throw vscode.FileSystemError.NoPermissions('read-only');"],
    ['title property', "vscode.window.showQuickPick(items, { title: 'Pick one' });"],
    ['placeHolder property', "vscode.window.showQuickPick(items, { placeHolder: 'Select' });"],
    ['prompt property', "vscode.window.showInputBox({ prompt: 'Name' });"],
    ['validationMessage assignment', "box.validationMessage = 'Required';"],
    ['label property', "const item = { label: 'Run' };"],
    ['description property', "const item = { description: 'Does a thing' };"],
    ['detail property', "const item = { detail: 'More' };"],
    ['tooltip property', "const button = { tooltip: 'Open' };"],
    ['createTerminal name', "vscode.window.createTerminal({ name: 'Migent' });"],
    ['validateInput return', "vscode.window.showInputBox({ validateInput: (value) => 'Bad' });"],
    ['notification API', "vscode.window.showWarningMessage('Direct');"],
    ['conditional validateInput literal', "vscode.window.showInputBox({ validateInput: (v) => (v ? 'Bad' : undefined) });"],
    ['block-bodied validateInput return', "vscode.window.showInputBox({ validateInput: (value) => { if (!value) return 'Bad'; return undefined; } });"],
    ['function-expression validateInput return', 'vscode.window.showInputBox({ validateInput: function (value) { return `Bad ${value}`; } });'],
    ['validateInput method return', "vscode.window.showInputBox({ validateInput(value) { return 'Bad'; } });"],
    ['provideTextDocumentContent return', "class P { provideTextDocumentContent(uri) { return 'Not here'; } }"],
    ['provideTextDocumentContent block return', "class P { provideTextDocumentContent(uri) { if (!uri) { return `x ${uri}`; } return text('a'); } }"],
    ['provideTextDocumentContent arrow', "const provider = { provideTextDocumentContent: () => 'Static' };"],
    ['conditional validateInput return', "vscode.window.showInputBox({ validateInput: (v) => { if (v) { return v.length ? 'Bad' : undefined; } return undefined; } });"],
    ['logical validateInput return', "vscode.window.showInputBox({ validateInput: (v) => { return v || 'Bad'; } });"],
    ['logical validateInput arrow', "vscode.window.showInputBox({ validateInput: (v) => !v && 'Bad' });"],
    ['nullish validateInput arrow', "vscode.window.showInputBox({ validateInput: (v) => problem(v) ?? 'Bad' });"],
    ['nested conditional validateInput', "vscode.window.showInputBox({ validateInput: (v) => (a ? (b ? 'x' : undefined) : text('y')) });"],
    ['conditional provider return', "class P { provideTextDocumentContent(uri) { return lines.length === 0 ? 'No events' : lines.join('\\n'); } }"],
    ['logical provider return', "class P { provideTextDocumentContent(uri) { return body || 'Empty'; } }"],
    ['conditional title property', "const o = { title: flag ? 'A' : 'B' };"],
    ['nullish label property', "const o = { label: name ?? 'Fallback' };"],
    ['logical description property', "const o = { description: has && 'Has it' };"],
    ['conditional prompt assignment', "box.prompt = flag ? 'a' : text('b');"],
    ['conditional status bar message', "vscode.window.setStatusBarMessage(flag ? 'a' : 'b', 1);"],
    ['nested conditional label', "const o = { label: a ? (b ? text('x') : 'y') : text('z') };"],
    ['three-deep wrapper', "const o = { tooltip: a ? (b ? (c ? 'x' : text('y')) : text('w')) : text('z') };"],
    ['conditional createTerminal name', "vscode.window.createTerminal({ name: flag ? 'A' : 'B' });"],
    ['conditional TreeItem label', "new vscode.TreeItem(flag ? 'A' : 'B', 1);"],
    ['imported TreeItem label', "import { TreeItem } from 'vscode';\nnew TreeItem('Files', 1);"],
    ['aliased TreeItem label', "import { TreeItem as Item } from 'vscode';\nnew Item('Files', 1);"],
    ['bare createOutputChannel', "import { window } from 'vscode';\nwindow.createOutputChannel('Migent');"],
    ['createWebviewPanel in webview folder', "vscode.window.createWebviewPanel('type', 'Session', 1, {});"],
  ];

  it.each(flagged)('reports a literal at %s', async (_name, code) => {
    expect((await messages(HOST, code)).length).toBeGreaterThan(0);
  });

  it('points the error at the catalog', async () => {
    const [first] = await messages(HOST, "output.appendLine('doctor');");
    expect(first).toContain(CATALOG_MESSAGE);
  });

  const allowed: [string, string][] = [
    ['catalog call', "vscode.window.setStatusBarMessage(text('prompts.cliRechecked'), 1);"],
    ['catalog call in a property', "vscode.window.showQuickPick(items, { title: text('prompts.openOutput') });"],
    ['catalog call in a template-free label', "const item = { label: text('views.files') };"],
    ['empty string', "const item = { label: '' };"],
    ['non-text property', "const item = { id: 'some-id', kind: 'leaf' };"],
    ['command id', "vscode.commands.executeCommand('migent.refresh');"],
    ['validateInput block returning the catalog', "vscode.window.showInputBox({ validateInput: (value) => { if (!value) return text('a'); return undefined; } });"],
    ['conditional validateInput catalog', "vscode.window.showInputBox({ validateInput: (v) => (v ? text('a') : undefined) });"],
    ['conditional of catalog calls', "const o = { title: flag ? text('prompts.a') : text('prompts.b') };"],
    ['catalog id chosen by a conditional', "const o = { title: text(flag ? 'prompts.a' : 'prompts.b') };"],
    ['nullish fallback to the catalog', "const o = { label: name ?? text('views.files') };"],
    ['nullish fallback to an empty string', "const o = { label: name ?? '' };"],
    ['conditional validateInput of catalog calls', "vscode.window.showInputBox({ validateInput: (v) => { return v ? text('a') : undefined; } });"],
    ['logical validateInput of the catalog', "vscode.window.showInputBox({ validateInput: (v) => !v && text('a') });"],
    ['conditional provider of catalog calls', "class P { provideTextDocumentContent(uri) { return n === 0 ? text('a') : lines.join('\\n'); } }"],
    ['validateInput returning undefined', 'vscode.window.showInputBox({ validateInput: (value) => { return undefined; } });'],
    ['provider returning catalog text', "class P { provideTextDocumentContent(uri) { return text('a'); } }"],
    ['nested function keeps its own returns', "class P { provideTextDocumentContent(uri) { const f = () => 'x'; return text(f()); } }"],
    ['imported TreeItem from the catalog', "import { TreeItem } from 'vscode';\nnew TreeItem(text('views.files'), 1);"],
  ];

  it.each(allowed)('allows %s', async (_name, code) => {
    expect(await messages(HOST, code)).toEqual([]);
  });

  it('applies to host files under src/vscode/webview', async () => {
    expect((await messages('src/vscode/webview/example.ts', "output.appendLine('x');")).length).toBeGreaterThan(0);
    expect((await messages('src/vscode/webview/example.ts', "const item = { label: 'Run' };")).length).toBeGreaterThan(0);
  });

  it('does not apply outside src/vscode', async () => {
    expect(await messages('src/core/example.ts', "const item = { label: 'Run' };")).toEqual([]);
  });

  it('does not apply to tests', async () => {
    expect(await messages('src/vscode/example.test.ts', "const item = { label: 'Run' };")).toEqual([]);
  });

  it('still reports the notification API outside src/vscode and allows it in the facade', async () => {
    expect((await messages('src/core/example.ts', "vscode.window.showWarningMessage('x');")).length).toBeGreaterThan(0);
    expect(await messages('src/vscode/notices.ts', "vscode.window.showWarningMessage('x');")).toEqual([]);
  });
});

describe('src/text leaf rule at every depth', () => {
  async function errorsAt(file: string, code: string): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
    return (result?.messages ?? []).filter((m) => (m.ruleId ?? '').endsWith('no-restricted-imports')).length;
  }

  it.each([
    ['src/text/example.ts', "import { shortId } from '../core/sessionPresentation';\nexport const x = shortId;"],
    ['src/text/sub/example.ts', "import { shortId } from '../../core/sessionPresentation';\nexport const x = shortId;"],
    ['src/text/sub/deep/example.ts', "import { shortId } from '../../../core/sessionPresentation';\nexport const x = shortId;"],
    ['src/text/sub/example.ts', "import { show } from '../../vscode/notices';\nexport const x = show;"],
    ['src/text/sub/example.ts', "import { runWithExecFile } from '../../cli/version';\nexport const x = runWithExecFile;"],
    ['src/text/sub/example.ts', "import * as vscode from 'vscode';\nexport const x = vscode;"],
  ])('rejects a runtime import in %s', async (file, code) => {
    expect(await errorsAt(file, code)).toBeGreaterThan(0);
  });

  it.each([
    ['src/text/sub/example.ts', "import type { WriteBlock } from '../../core/writeEligibility';\nexport type X = WriteBlock;"],
    ['src/text/sub/deep/example.ts', "import { type WriteBlock } from '../../../core/writeEligibility';\nexport type X = WriteBlock;"],
    ['src/text/sub/example.ts', "import { LABELS } from '../labels';\nexport const x = LABELS;"],
  ])('allows a type or sibling import in %s', async (file, code) => {
    expect(await errorsAt(file, code)).toBe(0);
  });
});

describe('src/text leaf rule', () => {
  async function importErrors(code: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, 'src/text/example.ts') });
    return (result?.messages ?? [])
      .filter((message) => message.ruleId === 'no-restricted-imports' || message.ruleId === '@typescript-eslint/no-restricted-imports')
      .map((message) => message.message);
  }

  it('rejects the VS Code API', async () => {
    expect((await importErrors("import * as vscode from 'vscode';\nexport const x = vscode;")).length).toBeGreaterThan(0);
  });

  it('rejects a value import from core', async () => {
    expect((await importErrors("import { shortId } from '../core/sessionPresentation';\nexport const x = shortId;")).length)
      .toBeGreaterThan(0);
  });

  it('allows a type import from core', async () => {
    expect(await importErrors("import type { WriteBlock } from '../core/writeEligibility';\nexport type X = WriteBlock;")).toEqual([]);
  });
});
