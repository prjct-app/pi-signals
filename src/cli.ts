#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { databasePath, config } from './config.ts';
import { SignalStore } from './store.ts';

async function main() {
  const [action = 'status', argument] = process.argv.slice(2);
  if (action === 'schedule' && argument === 'install') {
    return (await import('./scheduler.ts')).installSchedule(fileURLToPath(new URL('../bin/cli.mjs', import.meta.url)));
  }
  if (action === 'once') {
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Signals worker cancelled'));
    process.once('SIGTERM', abort); process.once('SIGINT', abort);
    try { return await (await import('./worker.ts')).runDaily(argument === '--scheduled', controller.signal); }
    finally { process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort); }
  }
  const store = new SignalStore(databasePath());
  try {
    if (action === 'status') { const issues = store.list(); return { config: config(), issues: issues.slice(0, 20), nextOffset: issues.length > 20 ? 20 : null }; }
    if (action === 'retry' && argument && /^[a-f0-9]{64}$/.test(argument)) return { queued: store.retry(argument) };
    if (action === 'show' && argument) return { issue: store.get(argument), observations: store.observations(argument), runs: store.runs(argument) };
    throw new Error('Usage: pi-signals status | show <id> | retry <id> | once [--scheduled] | schedule install');
  } finally { store.close(); }
}
try { console.log(JSON.stringify(await main(), null, 2)); }
catch (error) {
  const { protectOutboundData } = await import('@prjct.app/pi-secrets/privacy');
  console.error(await protectOutboundData(String(error)).catch(() => 'Signals failed; outbound privacy protection was unavailable.'));
  process.exitCode = 1;
}
