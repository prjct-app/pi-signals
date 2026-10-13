import { Type, type Static } from 'typebox';
import { copyFile, lstat, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { protectOutboundData } from '@prjct.app/pi-secrets/privacy';
import { runAgent, type AgentRunner } from './agent.ts';
import { command, must, type Check } from './commands.ts';
import { stateDir, type Repository } from './config.ts';
import type { LocalIssue } from './store.ts';
import { evidenceTool, type EvidenceSource } from './evidence.ts';

const FixSchema = Type.Object({
  explanation: Type.String({ minLength: 1 }),
  testFiles: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  regressionCommand: Type.String({ minLength: 1 }),
  failurePattern: Type.String({ minLength: 8 }),
}, { additionalProperties: false });
type Fix = Static<typeof FixSchema>;
const ReviewSchema = Type.Object({ fixesSignal: Type.Boolean(), testsMeaningful: Type.Boolean(), explanation: Type.String({ minLength: 1 }) });
export type RepairResult = { status: 'verified' | 'blocked'; explanation: string; base: string; head?: string; branch?: string; path: string; checks: Check[]; review?: unknown };

/** A regression test is replayed unchanged on the base and candidate, then the trusted suite runs. */
export async function repair(issue: LocalIssue, repo: Repository, path: string, base: string, observations: EvidenceSource, signal?: AbortSignal, agent: AgentRunner = runAgent): Promise<RepairResult> {
  const state: { fix?: Fix; review?: Static<typeof ReviewSchema> } = {};
  const checks: Check[] = [];
  const blocked = (explanation: string): RepairResult => ({ status: 'blocked', explanation, base, path, checks });
  await agent({ cwd: path, model: issue.model, writable: true, signal,
    prompt: `Repair signal ${issue.id} in this isolated worktree. Preserve the task, public Pi SDK architecture and model autonomy. No JEV, classifier substitution, hidden context pruning, or cost-based model changes. Keep the fix small and reuse existing code. Do not publish, push, merge, or commit; the coordinator owns release gates.\n`
      + `Add a meaningful regression test reproducing the exact observed failure. The SAME new test files will be copied to unchanged base ${base} and must fail there with the specific failurePattern; on your fix they must pass repeatedly. Do not edit existing tests or weaken assertions merely to make the suite pass. For latency use comparable repeated measurements; for response quality use the original task constraints and a controlled expected response, not general intelligence claims.\n`
      + `Read the original observations with signal_evidence. Use signal_fix to describe the fix and name only new test files (under tests/test/__tests__ or *.test.*/*.spec.*). Full suites: ${JSON.stringify(repo.tests)}.\n${JSON.stringify({ issue })}`,
    tools: [evidenceTool(observations).tool, { name: 'signal_fix', label: 'Submit repair candidate', description: 'Submit the candidate for independent baseline, regression, suite and semantic checks. This does not mark it fixed.', parameters: FixSchema,
      async execute(_id, input) { state.fix = input as Fix; return { content: [{ type: 'text', text: 'Candidate recorded for verification.' }], details: {} }; } }],
  });
  if (!state.fix) return blocked('No structured repair candidate was provided.');
  if (!repo.tests.length) return blocked('No trusted package validation commands are configured.');
  if (await must(path, ['git', 'rev-parse', 'HEAD'], signal) !== base) return blocked('The agent changed the candidate base before verification; no precommitted changes are accepted.');
  const fix = state.fix;
  const baselinePath = join(stateDir(), 'worktrees', `baseline-${issue.id.slice(0, 12)}-${Date.now()}`);
  await must(repo.path, ['git', 'worktree', 'add', '--detach', baselinePath, base], signal);
  for (const setup of repo.setup) await must(baselinePath, setup, signal);
  for (const file of fix.testFiles) {
    if (file.startsWith('/') || file.split(/[\\/]/).some(part => part === '..' || part === '.git') || !/(^|\/)(__tests__|tests?)\/|\.(test|spec)\./.test(file)) return blocked('Regression files must be new tests within the worktree.');
    const source = resolve(path, file), destination = resolve(baselinePath, file);
    if (!source.startsWith(path + sep) || !destination.startsWith(baselinePath + sep)) return blocked('Regression file escaped the worktree.');
    // Refuse symlinks throughout either path; do not copy arbitrary external files.
    for (const root of [path, baselinePath]) {
      const cursor = { current: root };
      for (const part of file.split('/')) {
        cursor.current = join(cursor.current, part);
        const stat = await lstat(cursor.current).catch(() => undefined);
        if (stat?.isSymbolicLink()) return blocked('Regression paths must not contain symlinks.');
      }
    }
    if ((await command(path, ['git', 'cat-file', '-e', `${base}:${file}`], signal)).code === 0) return blocked('Use a new regression test file so baseline assertions cannot be silently rewritten.');
    await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination);
  }
  const files = [...new Set((await must(path, ['git', 'diff', '--name-only', '-z'], signal) + '\0' + await must(path, ['git', 'ls-files', '--others', '--exclude-standard', '-z'], signal)).split('\0').filter(Boolean))];
  if (!files.length) return blocked('No changed files in the repair candidate.');
  const branch = `signals/${issue.id.slice(0, 12)}-${Date.now()}`;
  await must(path, ['git', 'switch', '-c', branch], signal);
  await must(path, ['git', 'add', '--', ...files], signal);
  const diff = await must(path, ['git', 'diff', '--cached', '--binary'], signal);
  if (await protectOutboundData(diff) !== diff) return blocked('The candidate diff contains data caught by outbound protection; publication is blocked.');
  await must(path, ['git', 'commit', '-m', `fix: ${issue.title}`], signal);
  const head = await must(path, ['git', 'rev-parse', 'HEAD'], signal);
  for (const _sample of [0, 1, 2]) {
    const before = await command(baselinePath, fix.regressionCommand, signal); checks.push(before);
    if (before.code === 0 || !before.output.includes(fix.failurePattern)) return blocked('The unchanged baseline did not consistently reproduce the claimed failure.');
    const after = await command(path, fix.regressionCommand, signal); checks.push(after);
    if (after.code !== 0) return blocked('The regression test still fails or is intermittent on the candidate.');
  }
  for (const test of repo.tests) {
    const check = await command(path, test, signal); checks.push(check);
    if (check.code !== 0) return blocked('A required package validation failed.');
  }
  await agent({ cwd: path, model: issue.model, writable: false, signal,
    prompt: `Review repair ${head} against base ${base} for signal ${issue.id}. You use the same model and reasoning as the originating agent. Inspect git diff ${base}..${head}, the new regression tests and these measured checks. Use signal_evidence for original observations and signal_validation for full check output by index. Passing tests alone is insufficient: decide whether the change addresses the actual reported failure, whether the assertion is meaningful, and whether latency/quality comparisons have controlled baselines. Reject weakened tests, output suppression, unrelated changes and context/model degradation. Do not modify files or publish. Record signal_review, or leave the candidate blocked.\n${JSON.stringify(await protectOutboundData({ issue, fix, checks: checks.map(({ command, code, durationMs }, index) => ({ index, command, code, durationMs })) }))}`,
    tools: [evidenceTool(observations).tool, { name: 'signal_validation', label: 'Read validation output', description: 'Read the complete recorded output of one check by its index.', parameters: Type.Object({ index: Type.Integer({ minimum: 0 }) }),
      async execute(_id, raw) { const check = checks[(raw as { index: number }).index]; if (!check) throw new Error('Unknown validation index.'); return { content: [{ type: 'text', text: JSON.stringify(await protectOutboundData(check)) }], details: {} }; } },
    { name: 'signal_review', label: 'Review regression repair', description: 'Record the semantic review of the exact tested candidate.', parameters: ReviewSchema,
      async execute(_id, input) { state.review = input as Static<typeof ReviewSchema>; return { content: [{ type: 'text', text: 'Review recorded.' }], details: {} }; } }],
  });
  if (!state.review?.fixesSignal || !state.review.testsMeaningful) return blocked(state.review?.explanation ?? 'No evidence-backed review approval.');
  if (await must(path, ['git', 'rev-parse', 'HEAD'], signal) !== head || await must(path, ['git', 'status', '--porcelain'], signal)) return blocked('The candidate changed after verification.');
  if (await must(repo.path, ['git', 'rev-parse', `${repo.base}^{commit}`], signal) !== base) return blocked('The base advanced; revalidation is required before merge.');
  return { status: 'verified', explanation: state.review.explanation, base, head, branch, path, checks: await protectOutboundData(checks), review: await protectOutboundData(state.review) };
}
