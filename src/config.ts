import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DefaultPackageManager, getAgentDir, getPackageDir, SettingsManager, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Target } from './schema.ts';

export const stateDir = () => join(process.env.PRJCT_HOME ?? join(homedir(), '.prjct'), 'shared', 'signals');
export const databasePath = () => join(stateDir(), 'signals.sqlite');
export type Repository = { path: string; base: string; setup: string[]; tests: string[] };
export type Config = { enabled: boolean; packages: string[]; workerPackages: string[]; repositories: Record<string, Repository>; timezone: string; hour: number; minute: number; repair: boolean; delivery: 'local' };
export function config(): Config {
  const defaults: Config = { enabled: true, packages: ['@prjct.app/'], workerPackages: ['@prjct.app/pi-secrets', '@prjct.app/pi-context-control', '@prjct.app/pi-self-compact'], repositories: {}, timezone: 'America/Cancun', hour: 9, minute: 0, repair: false, delivery: 'local' };
  try {
    const raw = JSON.parse(readFileSync(join(stateDir(), 'config.json'), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object');
    const value: Config = { ...defaults, ...raw };
    if (typeof value.enabled !== 'boolean' || typeof value.repair !== 'boolean' || value.delivery !== 'local'
      || !Array.isArray(value.packages) || !value.packages.every(prefix => typeof prefix === 'string' && prefix.length > 0)
      || !Array.isArray(value.workerPackages) || !value.workerPackages.every(name => typeof name === 'string' && name.length > 0)
      || !Number.isInteger(value.hour) || value.hour < 0 || value.hour > 23 || !Number.isInteger(value.minute) || value.minute < 0 || value.minute > 59
      || !value.repositories || typeof value.repositories !== 'object' || Array.isArray(value.repositories)) throw new Error('Invalid configuration');
    new Intl.DateTimeFormat('en', { timeZone: value.timezone });
    for (const repo of Object.values(value.repositories)) {
      if (!repo || !isAbsolute(repo.path) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(repo.base) || repo.base.includes('..')
        || !Array.isArray(repo.setup) || !Array.isArray(repo.tests) || ![...repo.setup, ...repo.tests].every(command => typeof command === 'string' && command.trim())) throw new Error('Invalid repository binding');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
    throw new Error('Invalid global signals configuration; processing is disabled until repaired.');
  }
}
function manifestTarget(root: string): Target | undefined {
  try {
    const value = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return typeof value.name === 'string' && typeof value.version === 'string' ? { id: value.name, version: value.version } : undefined;
  } catch { return undefined; }
}
export function targets(pi: ExtensionAPI, ctx: ExtensionContext, policy: Config): Target[] {
  const effective = pi.getSettings();
  const settings = effective.packages?.length ? SettingsManager.inMemory(effective) : SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: false });
  if (settings.drainErrors().some(error => error.scope === 'global')) throw new Error('Cannot read the global Pi package catalog.');
  const manager = new DefaultPackageManager({ cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager: settings });
  const installed = manager.listConfiguredPackages().flatMap(pkg => pkg.installedPath ? [manifestTarget(pkg.installedPath)].filter((value): value is Target => !!value) : [])
    .filter(target => policy.packages.some(prefix => target.id === prefix || (prefix.endsWith('/') && target.id.startsWith(prefix))));
  const core = manifestTarget(getPackageDir());
  return [...new Map([...installed, ...(core ? [{ ...core, id: 'pi' }] : [])].map(target => [target.id, target])).values()];
}
