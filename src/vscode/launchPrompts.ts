import * as vscode from 'vscode';

import { truncate } from '../core/sessionPresentation';

/**
 * The prompts New session and Next step share, so both ask for a launch the same way: Run now or Prepare, then a
 * one-line task (with a button that hands it over to `task.md`) or a session title.
 */

const TITLE_MAX_LENGTH = 60;

export const RUN_NOW = 'Run now';
export const PREPARE = 'Prepare';

export const LAUNCH_MODE_ITEMS = [
  { label: `$(play) ${RUN_NOW}`, description: 'Describe a task and start the workflow now', mode: 'run' },
  { label: `$(add) ${PREPARE}`, description: 'Create a session to start later', mode: 'prepare' },
] as const;

export type TaskInput = { kind: 'task'; text: string } | { kind: 'compose'; text: string };

/** The first non-blank line of a task as a session title. */
export function titleOf(text: string, fallback = 'Untitled task'): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)?.trim() ?? fallback;
  return truncate(line, TITLE_MAX_LENGTH);
}

/** Input Box for the task; its button hands the text over to an editor (the real `task.md`). */
export function askTask(title: string, value = ''): Promise<TaskInput | undefined> {
  return new Promise((resolveInput) => {
    const box = vscode.window.createInputBox();
    box.title = title;
    box.prompt = 'Describe the task';
    box.value = value;
    box.buttons = [{ iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Compose in editor' }];
    let isDone = false;
    const finish = (result: TaskInput | undefined): void => {
      if (isDone) return;
      isDone = true;
      box.dispose();
      resolveInput(result);
    };
    box.onDidAccept(() => {
      const text = box.value.trim();
      if (text.length === 0) {
        box.validationMessage = 'Enter a task, or use Compose in editor.';
        return;
      }
      finish({ kind: 'task', text });
    });
    box.onDidTriggerButton(() => {
      finish({ kind: 'compose', text: box.value });
    });
    box.onDidHide(() => {
      finish(undefined);
    });
    box.show();
  });
}

/** Input Box for the title of a prepared session; undefined when cancelled. */
export async function askTitle(title: string, value?: string): Promise<string | undefined> {
  const entered = await vscode.window.showInputBox({
    title,
    prompt: 'Session title',
    ...(value === undefined ? {} : { value }),
    validateInput: (text) => (text.trim().length === 0 ? 'Enter a title.' : undefined),
  });
  return entered?.trim();
}
