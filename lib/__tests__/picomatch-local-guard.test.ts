import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('local picomatch extglob guard', () => {
  it('loads the exact reviewed patch after installation', () => {
    const source = readFileSync(require.resolve('picomatch/lib/parse.js'), 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(source).digest('hex'))
      .toBe('995647c5581ba4b64b14365d52cbbcb3d59de8d488a26f07c394bc2bda3a8160');
  });

  it('bounds the reported patterns while retaining ordinary globs', () => {
    // A child-process timeout makes the regression test safe even if the guard
    // was accidentally removed and the regular expression backtracks forever.
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const pm = require('picomatch');
      for (const pattern of ['+(*)', '+(*a)', '+(a*)', '*(a*|b)', '+(ab|abab)']) {
        assert.equal(pm.isMatch(pattern, pattern), true);
        assert.equal(pm.isMatch('a'.repeat(80) + '!', pattern), false);
      }
      assert.equal(pm.isMatch('jsjsx', '+(js|jsx)'), true);
      assert.equal(pm.isMatch('src/app/page.ts', '**/*.ts'), true);
      assert.equal(pm.isMatch('src/app/page.js', '**/*.ts'), false);
      assert.equal(pm.isMatch('fff', '*(f)'), true);
    `], { cwd: process.cwd(), timeout: 3000, encoding: 'utf8' });
    expect(result.error?.message).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it('refuses a changed upstream file or dependency layout', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'msm-picomatch-'));
    try {
      for (const sub of ['scripts', 'vendor/picomatch/lib', 'node_modules/picomatch/lib']) mkdirSync(path.join(dir, sub), { recursive: true });
      copyFileSync(path.resolve('scripts/patch-picomatch.cjs'), path.join(dir, 'scripts/patch-picomatch.cjs'));
      copyFileSync(path.resolve('vendor/picomatch/lib/parse.js'), path.join(dir, 'vendor/picomatch/lib/parse.js'));
      writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/picomatch': { version: '4.0.7' } } }));
      const installed = path.join(dir, 'node_modules/picomatch/lib/parse.js');
      writeFileSync(installed, 'unexpected content');
      const changed = spawnSync(process.execPath, [path.join(dir, 'scripts/patch-picomatch.cjs')], { encoding: 'utf8' });
      expect(changed.status).not.toBe(0);
      expect(readFileSync(installed, 'utf8')).toBe('unexpected content');
      writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/picomatch': { version: '4.0.8' } } }));
      const drift = spawnSync(process.execPath, [path.join(dir, 'scripts/patch-picomatch.cjs')], { encoding: 'utf8' });
      expect(drift.status).not.toBe(0);
      expect(drift.stderr).toContain('dependency layout or version changed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
