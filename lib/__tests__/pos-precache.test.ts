import { describe, expect, it } from 'vitest';
import { collectPosAssets } from '../../scripts/lib/pos-precache.mjs';

describe('POS offline dependencies', () => {
  it('caches nested and dynamic POS dependencies while excluding back-office screens', () => {
    const chunk = (fileName: string, imports: string[] = [], dynamicImports: string[] = [], extra = {}) => ({
      type: 'chunk', fileName, imports, dynamicImports, isEntry: false, ...extra,
    });
    const assets = collectPosAssets({
      'assets/pos.js': chunk('assets/pos.js', ['assets/runtime.js', 'assets/trash-icon.js'], ['assets/worker-register.js'], { isEntry: true, name: 'pos', viteMetadata: { importedCss: new Set(['assets/theme.css']) } }),
      'assets/runtime.js': chunk('assets/runtime.js', ['assets/shared.js']),
      'assets/shared.js': chunk('assets/shared.js', ['assets/runtime.js']),
      'assets/trash-icon.js': chunk('assets/trash-icon.js'),
      'assets/worker-register.js': chunk('assets/worker-register.js'),
      'assets/reports.js': chunk('assets/reports.js', ['assets/runtime.js']),
    });
    expect([...assets].sort()).toEqual([
      'assets/pos.js', 'assets/runtime.js', 'assets/shared.js', 'assets/theme.css', 'assets/trash-icon.js', 'assets/worker-register.js',
    ]);
  });

  it('fails the build if the POS entry cannot be found', () => {
    expect(() => collectPosAssets({})).toThrow('POS entry chunk is missing');
  });
});
