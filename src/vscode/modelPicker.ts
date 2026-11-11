import * as vscode from 'vscode';

import { type ClientChoice, modelsDefaultFirst, type RoleModel } from '../core/controlArgs';
import { text } from '../text';

interface ModelItem extends vscode.QuickPickItem {
  model?: RoleModel;
}

/** One separator per client, then its models with the default first and marked. */
export function modelItems(clients: ClientChoice[]): ModelItem[] {
  const items: ModelItem[] = [];
  for (const choice of clients) {
    items.push({ label: choice.id, kind: vscode.QuickPickItemKind.Separator });
    for (const model of modelsDefaultFirst(choice)) {
      items.push({
        label: text('prompts.modelLabel', { client: choice.id, model }),
        description: model === choice.defaultModel ? text('prompts.modelDefault') : undefined,
        model: { client: choice.id, model },
      });
    }
  }
  return items;
}

export interface ModelPick {
  model: RoleModel;
  /** The title button was used: this model is for every remaining role. */
  isForAll: boolean;
}

const FOR_ALL_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('check-all'),
  tooltip: text('prompts.modelForAll'),
};

/** One filterable list; with `canPickAll`, a title button accepts the highlighted model for every role. */
export async function pickModel(
  title: string,
  clients: ClientChoice[],
  canPickAll: boolean,
): Promise<ModelPick | undefined> {
  const input = vscode.window.createQuickPick<ModelItem>();
  input.title = title;
  input.placeholder = text('prompts.modelFilter');
  input.matchOnDescription = true;
  input.items = modelItems(clients);
  if (canPickAll) input.buttons = [FOR_ALL_BUTTON];
  const subscriptions: vscode.Disposable[] = [];
  try {
    return await new Promise<ModelPick | undefined>((resolve) => {
      const finish = (isForAll: boolean): void => {
        const model = input.selectedItems[0]?.model ?? input.activeItems[0]?.model;
        resolve(model === undefined ? undefined : { model, isForAll });
        input.hide();
      };
      subscriptions.push(
        input.onDidAccept(() => finish(false)),
        input.onDidTriggerButton(() => finish(true)),
        input.onDidHide(() => resolve(undefined)),
      );
      input.show();
    });
  } finally {
    for (const subscription of subscriptions) subscription.dispose();
    input.dispose();
  }
}
