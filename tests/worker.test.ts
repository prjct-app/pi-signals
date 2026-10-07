import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { runDaily, scheduleTime } from '../src/worker.ts';
import { SignalStore } from '../src/store.ts';
import { capture, settings, temp } from './helpers.ts';

test('empty or unchanged daily queue costs zero agent calls', async () => {
  const path = join(temp(), 'signals.sqlite');
  const result = await runDaily(false, undefined, { config: () => settings(), databasePath: () => path, triage: async () => { throw new Error('unexpected agent request'); } });
  assert.equal(result.processed, 0);
});
test('daily triage leads to repair in the same run and preserves complete observations', async () => {
  const path = join(temp(), 'signals.sqlite'), store = new SignalStore(path); store.capture(capture()); store.close();
  const calls: string[] = [];
  const cfg = settings({ repair: true, repositories: { [capture().component]: { path: '/fixture', base: 'main', setup: [], tests: ['npm test'] } } });
  const result = await runDaily(false, undefined, { config: () => cfg, databasePath: () => path,
    worktree: async () => ({ path: '/fixture', base: 'baseline' }),
    triage: async (_issue, observations) => { calls.push('triage'); assert.equal(typeof observations === 'function' ? observations(0, 1).length : observations.length, 1); return { decision: { verdict: 'attention', reason: 'Crash reproduced.', evidence: ['FAIL: empty input crashed'] }, checks: [] }; },
    repair: async () => { calls.push('repair'); return { status: 'verified', base: 'baseline', path: '/fixture', explanation: 'Verified specific regression.', checks: [] }; },
  });
  assert.equal(result.processed, 1); assert.deepEqual(calls, ['triage', 'repair']);
  const reopened = new SignalStore(path); assert.equal(reopened.get(capture().id)?.status, 'verified'); assert.equal(reopened.runs(capture().id).length, 2); reopened.close();
});
test('unbound repositories are blocked, retain evidence and can be explicitly requeued', async () => {
  const path = join(temp(), 'signals.sqlite'), store = new SignalStore(path); store.capture(capture()); store.close();
  await runDaily(false, undefined, { config: () => settings(), databasePath: () => path });
  const reopened = new SignalStore(path); assert.equal(reopened.get(capture().id)?.status, 'blocked');
  assert.equal(reopened.observations(capture().id).length, 1); assert(reopened.retry(capture().id)); reopened.close();
});
test('daily due calculation uses configured timezone and clock, including midnight', () => {
  const cfg = settings();
  assert.deepEqual(scheduleTime(cfg, new Date('2026-10-07T13:59:00Z')), { day: '2026-10-07', due: false });
  assert.deepEqual(scheduleTime(cfg, new Date('2026-10-07T14:00:00Z')), { day: '2026-10-07', due: true });
  assert.deepEqual(scheduleTime(cfg, new Date('2026-10-08T05:00:00Z')), { day: '2026-10-08', due: false });
});
