import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir, type Repository } from './config.ts';
import { must } from './commands.ts';

export async function worktree(repo: Repository, runId: string, signal?: AbortSignal) {
  const base = await must(repo.path, ['git', 'rev-parse', '--verify', `${repo.base}^{commit}`], signal);
  const path = join(stateDir(), 'worktrees', runId);
  await mkdir(join(stateDir(), 'worktrees'), { recursive: true, mode: 0o700 });
  await must(repo.path, ['git', 'worktree', 'add', '--detach', path, base], signal);
  for (const setup of repo.setup) await must(path, setup, signal);
  return { path, base };
}
