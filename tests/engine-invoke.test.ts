import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ResolvedEngine } from '../src/engine.js';

/**
 * Integration tests for invokeEngineAsync using /bin/sh as a fake engine
 * binary. These pin the four behaviors that actually bit us during Phase 1
 * end-to-end validation: stdout capture, stderr surfacing on non-zero exit,
 * stdin-closed so cat-like children don't hang, and fast-kill on timeout.
 *
 * macOS/Linux only — the test suite already has other posix-specific parts.
 */

function shEngine(name: string, script: string): ResolvedEngine {
  return {
    name,
    label: name,
    config: {
      bin: '/bin/sh',
      // Ignore the prompt — fake engines don't consume it.
      args: () => ['-c', script],
    },
  };
}

test('invokeEngineAsync: returns trimmed stdout on zero exit', async () => {
  const { invokeEngineAsync } = await import('../src/engine.js');
  const out = await invokeEngineAsync(shEngine('fake-ok', 'printf "hello world\n"'), 'ignored');
  assert.equal(out, 'hello world');
});

test('invokeEngineAsync: rejects with stderr folded into the error message on non-zero exit', async () => {
  const { invokeEngineAsync } = await import('../src/engine.js');
  // Phase 1 validation bug: the old engine swallowed stderr, so every
  // pipeline failure reported "Command failed: claude" with no detail.
  // This pins that the child's stderr is now in the thrown Error message.
  await assert.rejects(
    () => invokeEngineAsync(
      shEngine('fake-fail', 'printf "actual error context" >&2; exit 2'),
      'ignored',
    ),
    (err) => {
      const msg = (err as Error).message;
      assert.match(msg, /failed/, 'message should identify the engine failure');
      assert.match(msg, /exit 2/, 'message should name the exit code');
      assert.match(msg, /actual error context/, 'message should include the child stderr');
      return true;
    },
  );
});

test('invokeEngineAsync: closes stdin so cat-like children see EOF immediately', async () => {
  // Phase 1 validation bug: leaving child stdin as an open pipe made the
  // `claude` CLI wait 3s for stdin data, print a warning, and exit non-zero.
  // The fix (stdio: ['ignore', 'pipe', 'pipe']) means a child that reads
  // stdin sees EOF on byte zero and exits cleanly. This test pins that by
  // using `cat` — which normally blocks on stdin — and asserting it returns
  // empty output promptly.
  const { invokeEngineAsync } = await import('../src/engine.js');
  const start = Date.now();
  const out = await invokeEngineAsync(shEngine('fake-cat', 'cat'), 'ignored');
  const elapsed = Date.now() - start;
  assert.equal(out, '');
  assert.ok(elapsed < 2000, `cat should exit immediately when stdin is closed; elapsed=${elapsed}ms`);
});

test('invokeEngineAsync: timeout kills the child promptly and rejects with a clear message', async () => {
  const { invokeEngineAsync } = await import('../src/engine.js');
  const start = Date.now();
  await assert.rejects(
    () => invokeEngineAsync(shEngine('fake-slow', 'sleep 5'), 'ignored', { timeout: 200 }),
    /timed out after 200ms/,
  );
  const elapsed = Date.now() - start;
  // Should fire near the 200ms deadline, not after the full 5s sleep.
  assert.ok(elapsed < 1500, `timeout should fire fast; elapsed=${elapsed}ms`);
});

test('invokeEngineAsync: captures multi-line stderr in the error message', async () => {
  const { invokeEngineAsync } = await import('../src/engine.js');
  await assert.rejects(
    () => invokeEngineAsync(
      shEngine(
        'fake-multiline-fail',
        'printf "line one\\nline two\\nline three\\n" >&2; exit 3',
      ),
      'ignored',
    ),
    (err) => {
      const msg = (err as Error).message;
      assert.match(msg, /exit 3/);
      assert.match(msg, /line one/);
      assert.match(msg, /line two/);
      assert.match(msg, /line three/);
      return true;
    },
  );
});

test('Claude invocations deliver complete UTF-8 input and preserve native flags', { skip: process.platform === 'win32' }, async (t) => {
  const { resolveEngine, invokeEngine, invokeEngineAsync, EngineInvocationError } = await import('../src/engine.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-claude-transport-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const bin = path.join(tmpDir, 'claude');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
if (model === 'invalid' || model === 'closed') {
  fs.closeSync(0);
  console.error('invalid model requested');
  process.exit(model === 'invalid' ? 7 : 0);
}
const input = fs.readFileSync(0);
process.stdout.write(JSON.stringify({ args, bytes: input.length, sha256: createHash('sha256').update(input).digest('hex') }));
`, { mode: 0o755 });

  const originalPath = process.env.PATH;
  let engine: ResolvedEngine;
  try {
    process.env.PATH = `${tmpDir}${path.delimiter}${originalPath ?? ''}`;
    engine = await resolveEngine({ engine: 'claude', model: 'opus', effort: 'medium', webSearch: true });
  } finally {
    process.env.PATH = originalPath;
  }
  engine = { ...engine, config: { ...engine.config, bin } };

  const large = `BEGIN\n${'α → retry🙂\n'.repeat(30_000)}END`;
  assert.ok(Buffer.byteLength(large) > 128 * 1024, 'must exceed the Linux per-argument limit');
  for (const invoke of [invokeEngine, invokeEngineAsync]) {
    for (const [size, user] of [['short', 'hello Ελληνικά\n--not-a-flag "quoted"'], ['large', large]]) {
      await t.test(`${invoke.name}: ${size} input`, async () => {
        const output = JSON.parse(await invoke(engine, `SYSTEM: Transport fixture system\n\n---\n\n${user}`, { timeout: 5_000 }));
        assert.deepEqual(output, {
          args: ['-p', '--allowedTools', 'WebSearch,WebFetch', '--output-format', 'text', '--system-prompt', 'Transport fixture system', '--model', 'opus', '--effort', 'medium'],
          bytes: Buffer.byteLength(user),
          sha256: createHash('sha256').update(user).digest('hex'),
        });
      });
    }

    await t.test(`${invoke.name}: early exit preserves the engine error`, async () => {
      await assert.rejects(
        async () => invoke({ ...engine, model: 'invalid' }, large, { timeout: 5_000 }),
        (error: unknown) => {
          assert.ok(error instanceof EngineInvocationError);
          assert.equal(error.reason, 'exit');
          assert.equal(error.code, 7);
          assert.equal(error.stderr.trim(), 'invalid model requested');
          assert.ok(!error.message.includes('BEGIN'));
          return true;
        },
      );
    });

    await t.test(`${invoke.name}: refuses success after an incomplete prompt write`, async () => {
      await assert.rejects(
        async () => invoke({ ...engine, model: 'closed' }, large, { timeout: 5_000 }),
        (error: unknown) => error instanceof EngineInvocationError && error.reason === 'spawn',
      );
    });
  }
});
