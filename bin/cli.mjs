#!/usr/bin/env node
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Pi omits its SDK peers when installing extension packages. Bind those peers to
// the engine that loaded the extension, using normal Node resolution from its root.
const peers = new Set(['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', 'typebox']);
try {
  const root = process.env.PI_SIGNALS_SDK_ROOT ?? JSON.parse(readFileSync(join(process.env.PRJCT_HOME ?? join(homedir(), '.prjct'), 'shared/signals/host.json'), 'utf8')).packageDir;
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== '@earendil-works/pi-coding-agent') throw new Error('Expected the installed Pi SDK package');
  const parentURL = pathToFileURL(join(root, 'package.json')).href;
  registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(specifier, peers.has(specifier) ? { ...context, parentURL } : context);
  } });
} catch {
  console.error('Load pi-signals in Pi once, or set PI_SIGNALS_SDK_ROOT to the installed Pi SDK package directory.');
  process.exit(1);
}
await import('../dist/cli.mjs');
