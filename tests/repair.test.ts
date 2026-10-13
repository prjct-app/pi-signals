import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { must } from '../src/commands.ts';
import { worktree } from '../src/worktree.ts';
import { repair } from '../src/repair.ts';
import { SignalStore } from '../src/store.ts';
import { call, capture, temp, write } from './helpers.ts';

async function fixture() {
  const path = temp();
  await must(path, ['git', 'init', '-b', 'main']); await must(path, ['git', 'config', 'user.email', 'signals-test@example.invalid']); await must(path, ['git', 'config', 'user.name', 'Signals Test']);
  write(join(path, 'value.cjs'), 'module.exports = () => 0;\n');
  await must(path, ['git', 'add', 'value.cjs']); await must(path, ['git', 'commit', '-m', 'fixture baseline']);
  const repo = { path, base: 'main', setup: [], tests: ['env -u NODE_TEST_CONTEXT node --test tests/*.test.cjs'] };
  const tree = await worktree(repo, `test-${Date.now()}-${Math.random()}`);
  const store = new SignalStore(join(temp(), 'signals.sqlite')); store.capture(capture()); const issue = store.get(capture().id)!; store.close();
  return { repo, tree, issue };
}
/** A call counter: the only mutable state here, behind tick() and count(). */
const counter = () => {
  const calls: true[] = [];
  return { tick: () => { calls.push(true); }, count: () => calls.length };
};

test('repair proves the same test fails before and passes after; original checkout remains unchanged', async () => {
  const f = await fixture(); const calls = counter();
  const result = await repair(f.issue, f.repo, f.tree.path, f.tree.base, [], undefined, async task => {
    calls.tick(); assert.equal(task.model?.thinkingLevel, 'high');
    if (task.writable) {
      write(join(task.cwd, 'value.cjs'), 'module.exports = () => 1;\n');
      write(join(task.cwd, 'tests/regression.test.cjs'), 'const assert = require("node:assert/strict"); assert.equal(require("../value.cjs")(), 1, "REGRESSION: wrong response value");\n');
      await call(task, 'signal_fix', { explanation: 'Return the required value.', testFiles: ['tests/regression.test.cjs'], regressionCommand: 'env -u NODE_TEST_CONTEXT node --test tests/regression.test.cjs', failurePattern: 'REGRESSION: wrong response value' });
    } else await call(task, 'signal_review', { fixesSignal: true, testsMeaningful: true, explanation: 'The unchanged assertion reproduces the observed output defect on the base and passes on the candidate.' });
  });
  assert.equal(result.status, 'verified', JSON.stringify(result)); assert.equal(result.checks.length, 7); assert.equal(calls.count(), 2);
  assert.equal(result.checks.filter(check => check.code !== 0).length, 3);
  assert.equal(await must(f.repo.path, ['git', 'rev-parse', 'HEAD']), f.tree.base);
  assert.equal(await must(f.repo.path, ['git', 'status', '--porcelain']), '');
});
test('a test that passes on the baseline cannot certify a fix or reach review', async () => {
  const f = await fixture(); const calls = counter();
  const result = await repair(f.issue, f.repo, f.tree.path, f.tree.base, [], undefined, async task => {
    calls.tick(); write(join(task.cwd, 'tests/fake.test.cjs'), 'require("node:assert/strict").equal(1, 1);\n');
    await call(task, 'signal_fix', { explanation: 'Insufficient test.', testFiles: ['tests/fake.test.cjs'], regressionCommand: 'env -u NODE_TEST_CONTEXT node --test tests/fake.test.cjs', failurePattern: 'REGRESSION: wrong response value' });
  });
  assert.equal(result.status, 'blocked'); assert.equal(calls.count(), 1); assert.match(result.explanation, /baseline/);
});

test('agent-created commits cannot bypass inspection of the complete candidate diff', async () => {
  const f = await fixture();
  const result = await repair(f.issue, f.repo, f.tree.path, f.tree.base, [], undefined, async task => {
    write(join(task.cwd, 'value.cjs'), 'module.exports = () => 1;\n');
    await must(task.cwd, ['git', 'add', 'value.cjs']); await must(task.cwd, ['git', 'commit', '-m', 'premature agent commit']);
    await call(task, 'signal_fix', { explanation: 'Premature commit.', testFiles: ['tests/new.test.cjs'], regressionCommand: 'node tests/new.test.cjs', failurePattern: 'REGRESSION failure' });
  });
  assert.equal(result.status, 'blocked'); assert.match(result.explanation, /precommitted/); assert.equal(result.checks.length, 0);
});
