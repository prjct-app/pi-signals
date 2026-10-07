import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getPackageDir, VERSION } from '@earendil-works/pi-coding-agent';
import { stateDir } from './config.ts';

/** Record only the host's public SDK location, never credentials or model data. */
export function rememberHost() {
  const root = stateDir(), file = join(root, 'host.json');
  const value = JSON.stringify({ packageDir: getPackageDir(), version: VERSION }) + '\n';
  try { if (readFileSync(file, 'utf8') === value) return; } catch { /* First load. */ }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const temporary = join(root, `host-${randomUUID()}.tmp`);
  writeFileSync(temporary, value, { mode: 0o600 }); renameSync(temporary, file);
}
