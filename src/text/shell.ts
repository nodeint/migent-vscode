/** Default titles of panels and the names of output channels and terminals. */
export const SHELL = {
  'shell.sessionPanel': () => 'Session',
  'shell.configPanel': () => 'Migent configuration',
  'shell.workflowPanel': () => 'Workflow',
  'shell.workflowPanelTitle': ({ name }: { name: string }) => `Workflow: ${name}`,
  'shell.outputChannel': () => 'Migent',
  'shell.sessionChannel': ({ id, label }: { id: string; label: string }) => `Migent: ${id} ${label}`,
  'shell.installTerminal': () => 'Migent: Install CLI',
} as const;
