import { describe, expect, it } from 'vitest';

import type { WorkflowEditorModel } from '../../core/workflowEditor';
import { saveRefusal } from './panels';

const identity = { project: 'k', file: 'plan.yaml' };
const model = (canSave: boolean): Pick<WorkflowEditorModel, 'canSave'> => ({ canSave });

describe('saveRefusal', () => {
  it('refuses a save before any model was published, whatever the page asks', () => {
    expect(saveRefusal(identity, null)).toMatch(/cannot be saved/);
  });

  it('refuses an unsupported or unreadable model and points to migrate', () => {
    expect(saveRefusal(identity, model(false))).toMatch(/migent migrate/);
  });

  it('refuses a file that is not .yaml even on a savable model', () => {
    expect(saveRefusal({ ...identity, file: 'plan.yml' }, model(true))).toMatch(/\.yaml/);
  });

  it('allows a savable .yaml model', () => {
    expect(saveRefusal(identity, model(true))).toBeNull();
  });
});
