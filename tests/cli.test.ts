import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getPackageDir } from '@earendil-works/pi-coding-agent';
import { temp, write } from './helpers.ts';

test('npm CLI runs without local SDK peers and uses the recorded host binding', () => {
  const root = temp(), packageRoot = join(root, 'package'), prjct = join(root, 'prjct'), agent = join(root, 'agent');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true }); mkdirSync(join(packageRoot, 'dist'), { recursive: true }); mkdirSync(agent);
  copyFileSync(resolve('bin/cli.mjs'), join(packageRoot, 'bin/cli.mjs'));
  copyFileSync(resolve('dist/cli.mjs'), join(packageRoot, 'dist/cli.mjs'));
  const env = { ...process.env, PRJCT_HOME: prjct, PI_CODING_AGENT_DIR: agent, PI_SIGNALS_SDK_ROOT: getPackageDir() };
  const first = JSON.parse(execFileSync(process.execPath, [join(packageRoot, 'bin/cli.mjs'), 'once'], { env, encoding: 'utf8' }));
  assert.equal(first.processed, 0);
  write(join(prjct, 'shared/signals/host.json'), JSON.stringify({ packageDir: getPackageDir() }));
  delete (env as NodeJS.ProcessEnv).PI_SIGNALS_SDK_ROOT;
  const second = JSON.parse(execFileSync(process.execPath, [join(packageRoot, 'bin/cli.mjs'), 'status'], { env, encoding: 'utf8' }));
  assert.equal(second.issues.length, 0);
  assert(readFileSync(join(packageRoot, 'dist/cli.mjs'), 'utf8').includes('../bin/cli.mjs'), 'scheduler uses the bootstrap too');
});
