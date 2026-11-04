import { describe, expect, it } from 'vitest';

import { pageHtml } from './pageHtml';

const input = {
  cspSource: 'https://file+.vscode-resource.example',
  nonce: 'abc123',
  title: 'Result',
  styles: ['vscode-resource:/shared/base.css', 'vscode-resource:/results/results.css'],
  scripts: ['vscode-resource:/shared/page.js', 'vscode-resource:/results/results.js'],
};

describe('pageHtml', () => {
  it('emits the unchanged content security policy', () => {
    expect(pageHtml(input)).toContain(
      'content="default-src \'none\'; style-src https://file+.vscode-resource.example; script-src \'nonce-abc123\';"',
    );
  });

  it('puts the nonce on every script and loads shared assets before the page assets', () => {
    const html = pageHtml(input);
    expect(html.match(/<script nonce="abc123"/g)).toHaveLength(2);
    expect(html).not.toContain('<script src');
    expect(html.indexOf('shared/base.css')).toBeLessThan(html.indexOf('results/results.css'));
    expect(html.indexOf('shared/page.js')).toBeLessThan(html.indexOf('results/results.js'));
    expect(html).toContain('<main id="root"></main>');
    expect(html).toContain('<html lang="en">');
  });

  it('escapes the title and attribute values', () => {
    const html = pageHtml({ ...input, title: '<b>x</b>', styles: ['a"b.css'] });
    expect(html).toContain('<title>&lt;b&gt;x&lt;/b&gt;</title>');
    expect(html).toContain('href="a&quot;b.css"');
  });
});
