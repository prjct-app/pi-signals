import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { SignalStore } from '../src/store.ts';
import { capture, temp } from './helpers.ts';

test('global SQLite deduplicates sightings across sessions and retains separate evidence', () => {
  const path = join(temp(), 'signals.sqlite'), first = new SignalStore(path), second = new SignalStore(path);
  try {
    assert.equal(first.capture(capture()).duplicate, false);
    assert.equal(second.capture(capture()).duplicate, true);
    assert.equal(second.capture(capture({ observationId: 'c'.repeat(64), version: '1.0.1' })).sightings, 2);
    assert.equal(first.get(capture().id)?.revision, 2); assert.equal(first.observations(capture().id).length, 2);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert(first.acquire('worker', 120_000)); assert.equal(second.acquire('worker', 120_000), undefined);
  } finally { first.close(); second.close(); }
  const reopened = new SignalStore(path); assert.equal(reopened.get(capture().id)?.sightings, 2); reopened.close();
});
test('new evidence reopens decisions and prevents stale triage from retiring a signal', () => {
  const store = new SignalStore(join(temp(), 'signals.sqlite'));
  try {
    store.capture(capture());
    const owner = store.acquire('worker', 120_000)!;
    const run = store.begin(store.get(capture().id)!, owner, 'triage');
    store.capture(capture({ observationId: 'c'.repeat(64) }));
    store.finish(run, 'flaky', {}, { verdict: 'flaky', reason: 'Mixed outcomes.', evidence: ['Recorded failures.'] });
    assert.equal(store.get(capture().id)?.status, 'new');
    const next = store.begin(store.get(capture().id)!, owner, 'triage'); store.finish(next, 'flaky', {});
    assert.equal(store.pending().length, 0);
    assert.equal(store.observations(capture().id).length, 2);
    store.capture(capture({ observationId: 'd'.repeat(64) })); assert.equal(store.pending().length, 1);
  } finally { store.close(); }
});
test('interrupted workers retain evidence and daily runs can recover', () => {
  const store = new SignalStore(join(temp(), 'signals.sqlite'));
  try {
    const owner = store.acquire('worker', 120_000)!;
    store.capture(capture()); store.begin(store.get(capture().id)!, owner, 'repair');
    store.startDay('2026-10-07'); assert(store.due('2026-10-07'));
    store.recover(owner); assert.equal(store.get(capture().id)?.status, 'new');
    assert.equal(store.runs(capture().id)[0]!.state, 'interrupted');
    store.finishDay('2026-10-07'); assert(!store.due('2026-10-07'));
  } finally { store.close(); }
});

test('a stale worker cannot overwrite a new worker decision', () => {
  const store = new SignalStore(join(temp(), 'signals.sqlite'));
  try {
    store.capture(capture()); const old = store.acquire('worker', 120_000)!;
    const run = store.begin(store.get(capture().id)!, old, 'triage');
    store.release('worker', old); assert(store.acquire('worker', 120_000));
    assert.throws(() => store.finish(run, 'resolved', {}), /lease lost/);
    assert.equal(store.get(capture().id)?.status, 'triaging');
  } finally { store.close(); }
});
