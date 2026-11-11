import * as vscode from 'vscode';

import { truncate } from '../core/sessionPresentation';
import { text } from '../text';

/**
 * The prompts New session and Next step share, so both ask for a launch the same way: Run now or Prepare, then a
 * one-line task (with a button that hands it over to `task.md`) or a session title.
 */

const TITLE_MAX_LENGTH = 60;

export const LAUNCH_MODE_ITEMS = [
  { label: text('prompts.runNowLabel'), description: text('prompts.runNowDescription'), mode: 'run' },
  { label: text('prompts.prepareLabel'), description: text('prompts.prepareDescription'), mode: 'prepare' },
] as const;

export type TaskInput = { kind: 'task'; text: string } | { kind: 'compose'; text: string };

/** The first non-blank line of a task as a session title. */
export function titleOf(task: string, fallback = text('prompts.untitledTask')): string {
  const line = task.split(/\r?\n/).find((candidate) => candidate.trim().length > 0)?.trim() ?? fallback;
  return truncate(line, TITLE_MAX_LENGTH);
}

/** Input Box for the task; its button hands the text over to an editor (the real `task.md`). */
export function askTask(title: string, value = ''): Promise<TaskInput | undefined> {
  return new Promise((resolveInput) => {
    const box = vscode.window.createInputBox();
    box.title = title;
    box.prompt = text('prompts.describeTask');
    box.value = value;
    box.buttons = [{ iconPath: new vscode.ThemeIcon('edit'), tooltip: text('prompts.composeInEditor') }];
    let isDone = false;
    const finish = (result: TaskInput | undefined): void => {
      if (isDone) return;
      isDone = true;
      box.dispose();
      resolveInput(result);
    };
    box.onDidAccept(() => {
      const task = box.value.trim();
      if (task.length === 0) {
        box.validationMessage = text('prompts.enterTask');
        return;
      }
      finish({ kind: 'task', text: task });
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
    prompt: text('prompts.sessionTitle'),
    ...(value === undefined ? {} : { value }),
    validateInput: (input) => (input.trim().length === 0 ? text('prompts.enterTitle') : undefined),
  });
  return entered?.trim();
}
