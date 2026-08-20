import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureReady, inspectReady, repoRootFromScript } from '../scripts/ensure-ready.mjs';

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fakeRepo(options: { commander?: boolean; typescript?: boolean; dist?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ensure-ready-'));
  writeJson(path.join(root, 'package.json'), {
    name: 'fixture',
    dependencies: { commander: '^14.0.0' },
    devDependencies: { typescript: '^6.0.0' },
  });
  if (options.commander) writeJson(path.join(root, 'node_modules', 'commander', 'package.json'), { name: 'commander' });
  if (options.typescript) writeJson(path.join(root, 'node_modules', 'typescript', 'package.json'), { name: 'typescript' });
  if (options.dist) {
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'cli.js'), 'export {}\n');
  }
  return root;
}

test('inspectReady asks for install + build after a full mo purge', () => {
  const root = fakeRepo();
  const needed = inspectReady(root);
  assert.equal(needed.install, true);
  assert.equal(needed.build, true);
  assert.deepEqual(needed.missingRuntime, ['commander']);
});

test('inspectReady asks only for install when dist survived', () => {
  const root = fakeRepo({ dist: true });
  const needed = inspectReady(root);
  assert.equal(needed.install, true);
  assert.equal(needed.build, false);
});

test('inspectReady asks only for build when node_modules survived', () => {
  const root = fakeRepo({ commander: true, typescript: true });
  const needed = inspectReady(root);
  assert.equal(needed.install, false);
  assert.equal(needed.build, true);
});

test('inspectReady is a no-op when the checkout is already runnable', () => {
  const root = fakeRepo({ commander: true, typescript: true, dist: true });
  const needed = inspectReady(root);
  assert.equal(needed.install, false);
  assert.equal(needed.build, false);
});

test('ensureReady --dry-run does not spawn npm', () => {
  const root = fakeRepo();
  let calls = 0;
  const result = ensureReady(root, { dryRun: true, run: () => { calls += 1; return { status: 0 }; } });
  assert.equal(calls, 0);
  assert.equal(result.install, true);
  assert.equal(result.build, true);
  assert.deepEqual(result.actions, []);
});

test('ensureReady uses npm ci when it works', () => {
  const root = fakeRepo();
  const calls: string[][] = [];
  const result = ensureReady(root, {
    run: (_command, args) => {
      calls.push(args);
      if (args[0] === 'ci') {
        writeJson(path.join(root, 'node_modules', 'commander', 'package.json'), { name: 'commander' });
        writeJson(path.join(root, 'node_modules', 'typescript', 'package.json'), { name: 'typescript' });
      }
      if (args[0] === 'run' && args[1] === 'build') {
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist', 'cli.js'), 'export {}\n');
      }
      return { status: 0 };
    },
  });
  assert.deepEqual(calls, [['ci'], ['run', 'build']]);
  assert.deepEqual(result.actions, ['install', 'build']);
});

test('ensureReady npm-ci then builds, falling back to npm install', () => {
  const root = fakeRepo();
  const calls: string[][] = [];
  const result = ensureReady(root, {
    run: (_command, args) => {
      calls.push(args);
      if (args[0] === 'ci' && calls.filter((item) => item[0] === 'ci').length === 1) {
        return { status: 1 };
      }
      if (args[0] === 'install' || args[0] === 'ci') {
        writeJson(path.join(root, 'node_modules', 'commander', 'package.json'), { name: 'commander' });
        writeJson(path.join(root, 'node_modules', 'typescript', 'package.json'), { name: 'typescript' });
      }
      if (args[0] === 'run' && args[1] === 'build') {
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist', 'cli.js'), 'export {}\n');
      }
      return { status: 0 };
    },
  });
  assert.deepEqual(calls, [['ci'], ['install'], ['run', 'build']]);
  assert.deepEqual(result.actions, ['install', 'build']);
  assert.equal(result.install, false);
  assert.equal(result.build, false);
});

test('ensureReady skips npm when only dist is missing', () => {
  const root = fakeRepo({ commander: true, typescript: true });
  const calls: string[][] = [];
  const result = ensureReady(root, {
    run: (_command, args) => {
      calls.push(args);
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'dist', 'cli.js'), 'export {}\n');
      return { status: 0 };
    },
  });
  assert.deepEqual(calls, [['run', 'build']]);
  assert.deepEqual(result.actions, ['build']);
});

test('repoRootFromScript points at this package', () => {
  const root = repoRootFromScript();
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name, 'fieldtheory');
});
