import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface Welcome { view: string; contents: string; when: string }
interface Manifest {
  contributes: { viewsWelcome: Welcome[]; menus: { commandPalette: { command: string; when?: string }[] } };
}

const manifest = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as Manifest;
const sessions = manifest.contributes.viewsWelcome.filter((entry) => entry.view === 'migent.sessions');

describe('CLI onboarding manifest', () => {
  it('shows an install link only when not installing, whether or not a project exists', () => {
    const links = sessions.filter((entry) => entry.contents.includes('command:migent.cli.install'));
    expect(links.length).toBeGreaterThan(0);
    for (const entry of links) expect(entry.when).toContain('!migent.cliInstalling');
    const missing = sessions.find((entry) => entry.when.includes('cliState == missing'));
    expect(missing?.when).not.toContain('hasProjects');
    expect(sessions.some((entry) => entry.when.includes('migent.hasProjects && migent.cliState == missing'))).toBe(false);
  });

  it('shows an installing message and disables the palette command while installing', () => {
    const installing = sessions.find((entry) => entry.when === 'migent.cliInstalling');
    expect(installing?.contents).not.toContain('command:migent.cli.install');
    const palette = manifest.contributes.menus.commandPalette.find((entry) => entry.command === 'migent.cli.install');
    expect(palette?.when).toContain('!migent.cliInstalling');
  });
});
