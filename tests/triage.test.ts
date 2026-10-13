import assert from 'node:assert/strict';
import { test } from 'node:test';
import { triage } from '../src/triage.ts';
import { SignalStore } from '../src/store.ts';
import { join } from 'node:path';
import { capture, temp, call } from './helpers.ts';

const issue = () => { const store = new SignalStore(join(temp(), 'signals.sqlite')); store.capture(capture()); const value = store.get(capture().id)!; store.close(); return value; };
/** A call counter: the only mutable state here, behind tick() and count(). */
const counter = () => {
  const calls: true[] = [];
  return { tick: () => { calls.push(true); }, count: () => calls.length };
};

test('agent owns triage and inherits the original model/reasoning', async () => {
  const result = await triage(issue(), [{ payload: capture().payload }], temp(), undefined, async task => {
    assert.equal(task.model?.id, 'model'); assert.equal(task.model?.thinkingLevel, 'high'); assert(!task.writable);
    await call(task, 'signal_evidence', {});
    await call(task, 'signal_triage', { verdict: 'attention', reason: 'Evidence identifies a crashing path.', evidence: ['FAIL: empty input crashed'] });
  });
  assert.equal(result.decision.verdict, 'attention');
});
test('missing findings retain uncertainty without an extra generation', async () => {
  const calls = counter();
  const result = await triage(issue(), [], temp(), undefined, async () => { calls.tick(); });
  assert.equal(result.decision.verdict, 'needs_evidence'); assert.equal(calls.count(), 1);
});
test('flaky needs mixed outcomes from the same real reproduction, not unrelated commands', async () => {
  const result = await triage(issue(), [{ payload: capture().payload }], temp(), undefined, async task => {
    await call(task, 'signal_check', { command: 'printf "unrelated pass"' });
    await call(task, 'signal_check', { command: 'printf "unrelated fail"; exit 1' });
    await assert.rejects(call(task, 'signal_triage', { verdict: 'flaky', reason: 'Not enough.', evidence: ['unrelated fail'] }), /same reproduction/);
    const command = 'if test -f marker; then printf "reproduction passed"; else touch marker; printf "reproduction failed"; exit 1; fi';
    await call(task, 'signal_check', { command }); await call(task, 'signal_check', { command });
    await call(task, 'signal_triage', { verdict: 'flaky', reason: 'Same reproduction produced mixed outcomes.', evidence: ['reproduction failed', 'reproduction passed'] });
  });
  assert.equal(result.decision.verdict, 'flaky'); assert.equal(result.checks.length, 4);
});
