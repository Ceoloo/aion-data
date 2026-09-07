#!/usr/bin/env node
/**
 * Bootstrap the AION Core dependency.
 *
 * AION Data implements AION Core's persistence ports, so it must build against
 * the *real* Core contracts, not a copy (that would fork canonical shapes — see
 * aion-docs/repositories/dependency-rules.md #4). Core is not published to a
 * registry and its `files` field ships only `dist`, which is not committed, so a
 * plain `github:` install yields an empty package.
 *
 * This script therefore vendors Core the only reliable way: clone the pinned
 * commit into `vendor/aion-core` (git-ignored) and build it, so the
 * `file:vendor/aion-core` dependency in package.json resolves to a real, built
 * package. It is idempotent — a clean, correctly-pinned, already-built vendor
 * dir is left untouched.
 *
 * Determinism: the commit is pinned. Override with AION_CORE_REF only
 * deliberately. Skip entirely with AION_SKIP_CORE_SETUP=1 (e.g. when a
 * pre-provisioned Core is mounted).
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_REPO = process.env.AION_CORE_REPO ?? 'https://github.com/Ceoloo/aion-core';
// Mission 009 aion-core tip (ExternalSideEffect + CRM catalog). Re-pin after core lands.
const CORE_REF = process.env.AION_CORE_REF ?? '9b280c5cdee168e9c8a695c6e072b78726e18270';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = resolve(root, 'vendor', 'aion-core');

function run(cmd, cwd) {
  console.log(`[setup-core] $ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function currentHead(dir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
  } catch {
    return undefined;
  }
}

function main() {
  if (process.env.AION_SKIP_CORE_SETUP) {
    console.log('[setup-core] AION_SKIP_CORE_SETUP set — skipping.');
    return;
  }

  const built = existsSync(resolve(vendorDir, 'dist', 'index.js'));
  const head = currentHead(vendorDir);
  if (built && head === CORE_REF) {
    console.log(`[setup-core] vendor/aion-core already built at ${CORE_REF} — skipping.`);
    return;
  }

  // Any partial/stale checkout is discarded and rebuilt deterministically.
  if (existsSync(vendorDir)) {
    console.log('[setup-core] refreshing vendor/aion-core …');
    rmSync(vendorDir, { recursive: true, force: true });
  }

  run(`git clone --quiet ${CORE_REPO} "${vendorDir}"`, root);
  run(`git checkout --quiet ${CORE_REF}`, vendorDir);
  run('npm install --no-audit --no-fund --loglevel=error', vendorDir);
  run('npm run build', vendorDir);

  console.log(`[setup-core] vendor/aion-core ready at ${CORE_REF}.`);
}

main();
