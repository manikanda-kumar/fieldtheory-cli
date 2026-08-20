#!/usr/bin/env node
/**
 * Restore the CLI checkout after Mole (`mo purge`) deletes node_modules and dist.
 * Uses only Node builtins so it can run when commander is gone.
 *
 * Usage: node scripts/ensure-ready.mjs [--dry-run] [repo-root]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function repoRootFromScript(scriptUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), '..');
}

function depDir(root, name) {
  return path.join(root, 'node_modules', ...name.split('/'));
}

function readPackage(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function missingNamedPackages(root, names) {
  return names.filter((name) => !fs.existsSync(path.join(depDir(root, name), 'package.json')));
}

export function inspectReady(root) {
  const pkg = readPackage(root);
  const runtime = Object.keys(pkg.dependencies ?? {});
  const missingRuntime = missingNamedPackages(root, runtime);
  const distMissing = !fs.existsSync(path.join(root, 'dist', 'cli.js'));
  const missingDev = distMissing
    ? missingNamedPackages(root, ['typescript', ...Object.keys(pkg.devDependencies ?? {})])
    : [];
  return {
    install: missingRuntime.length > 0 || missingDev.length > 0,
    build: distMissing,
    missingRuntime,
    missingDev,
  };
}

function runNpm(root, args, run) {
  const result = run('npm', args, { cwd: root });
  const status = result?.status ?? 1;
  if (status === 0) return;
  const detail = [result?.error?.message, result?.stderr].filter(Boolean).join(' ').trim();
  throw new Error(`npm ${args.join(' ')} failed (exit ${status})${detail ? `: ${detail}` : ''}`);
}

export function ensureReady(root, options = {}) {
  const needed = inspectReady(root);
  const actions = [];
  if (options.dryRun) return { ...needed, actions };
  const run = options.run ?? ((command, args, spawnOptions) => spawnSync(command, args, {
    cwd: spawnOptions?.cwd ?? root,
    env: process.env,
    stdio: 'inherit',
  }));
  if (needed.install) {
    actions.push('install');
    try {
      runNpm(root, ['ci'], run);
    } catch (error) {
      try {
        runNpm(root, ['install'], run);
      } catch (installError) {
        const first = error instanceof Error ? error.message : String(error);
        const second = installError instanceof Error ? installError.message : String(installError);
        throw new Error(`${first}; then ${second}`);
      }
    }
  }
  const afterInstall = inspectReady(root);
  if (afterInstall.build) {
    actions.push('build');
    runNpm(root, ['run', 'build'], run);
  }
  return { ...inspectReady(root), actions };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function parseArgs(argv) {
  let dryRun = false;
  const positional = [];
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/ensure-ready.mjs [--dry-run] [repo-root]');
      process.exit(0);
    } else positional.push(arg);
  }
  return { dryRun, root: positional[0] };
}

if (isMain()) {
  const { dryRun, root: rootArg } = parseArgs(process.argv.slice(2));
  const root = rootArg ? path.resolve(rootArg) : repoRootFromScript();
  try {
    const result = ensureReady(root, { dryRun });
    if (dryRun) {
      console.log(JSON.stringify({
        root,
        install: result.install,
        build: result.build,
        missingRuntime: result.missingRuntime,
        missingDev: result.missingDev,
      }));
    } else if (result.actions.length === 0) {
      console.log('ensure-ready: already ready');
    } else {
      console.log(`ensure-ready: ${result.actions.join(' + ')}`);
    }
  } catch (error) {
    console.error(`ensure-ready: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
