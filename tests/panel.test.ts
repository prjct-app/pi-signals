import assert from 'node:assert/strict';
import { test } from 'node:test';
import { panelText, type PanelControl } from '@prjct.app/pi-tui-kit';
import { signalPanelSpec, type SignalPanelOps } from '../src/panel.ts';
import type { LocalIssue, Status } from '../src/store.ts';
import { settings } from './helpers.ts';

const NOW = Date.UTC(2026, 9, 9, 12);
const issue = (id: string, status: Status, overrides: Partial<LocalIssue> = {}): LocalIssue => ({
  id, component: 'pi-team', category: 'response-quality', title: `Issue ${id}`, status, revision: 1, sightings: 2,
  created: NOW - 3_600_000, updated: NOW - 60_000, ...overrides,
});
const ops = (issues: LocalIssue[], overrides: Partial<SignalPanelOps> = {}): SignalPanelOps & { retried: string[] } => {
  const retried: string[] = [];
  return {
    retried,
    config: () => settings({ enabled: true, hour: 3, minute: 0, timezone: 'America/Mexico_City', repair: false, repositories: {} }),
    issues: () => issues,
    observations: () => [{ created: NOW - 120_000, version: '0.10.0', payload: { title: 'Teammates stall after info', body: 'details' } }],
    runs: () => [{ phase: 'triage', state: 'finished', started: NOW - 30_000, result: { status: 'attention', explanation: 'info does not wake' } }],
    days: () => [{ day: '2026-10-09', started: NOW - 7_200_000, finished: NOW - 7_100_000 }],
    retry: id => { retried.push(id); return true; },
    now: () => NOW,
    ...overrides,
  };
};
const control = () => {
  const notices: string[] = [];
  const panel: PanelControl = { refresh() {}, notice: text => { notices.push(text); }, select() {}, close() {} };
  return { panel, notices };
};

test('with no issues the panel shows the daily triage and how issues arrive', () => {
  const spec = signalPanelSpec(ops([]));
  assert.equal(spec.summary!(), '0 issues · 0 to fix · triage 03:00 America/Mexico_City');
  assert.deepEqual(spec.items().map(item => item.id), ['__triage__']);
  const detail = spec.detail(spec.items()[0]!);
  assert.equal(detail.title, 'Daily triage');
  assert.match(JSON.stringify(detail.sections), /No issues yet/);
  assert.match(JSON.stringify(detail.sections), /2026-10-09 {2}finished/);
  assert.equal(spec.initial, '__triage__');
});

test('what needs a fix comes first, with component, status and sightings', () => {
  const spec = signalPanelSpec(ops([issue('a', 'resolved'), issue('b', 'new'), issue('c', 'attention'), issue('d', 'blocked')]));
  assert.equal(spec.summary!(), '4 issues · 2 to fix · triage 03:00 America/Mexico_City');
  assert.deepEqual(spec.items().map(item => item.id), ['__triage__', 'c', 'd', 'b', 'a']);
  assert.equal(spec.items()[1]!.label, 'pi-team · Issue c');
  assert.equal(spec.items()[1]!.meta, 'fix · 2×');
  assert.equal(spec.initial, 'c', 'the panel opens on the first thing to fix');
  const text = panelText(spec);
  assert.match(text, /^Signals · 4 issues · 2 to fix/);
  assert.match(text, /! pi-team · Issue c · fix · 2×/);
});

test('an issue detail shows status, triage decision, observations and runs', () => {
  const spec = signalPanelSpec(ops([issue('c', 'attention', { lastError: 'worker crashed', model: { provider: 'openai-codex', id: 'gpt-6-sol' },
    decision: { verdict: 'attention', reason: 'Reproduced twice', evidence: ['session entry 42'] } })]));
  const detail = spec.detail(spec.items()[1]!);
  assert.equal(detail.subtitle, 'pi-team · response-quality');
  const fields = Object.fromEntries((detail.fields ?? []).map(field => [field.label, field.value]));
  assert.equal(fields.Status, 'needs a fix');
  assert.equal(fields.Seen, '2 times');
  assert.equal(fields.Model, 'openai-codex/gpt-6-sol');
  assert.equal(fields['Last error'], 'worker crashed');
  const sections = Object.fromEntries((detail.sections ?? []).map(section => [section.title, section.lines]));
  assert.deepEqual(sections['Triage: attention'], ['Reproduced twice', '· session entry 42']);
  assert.match(sections.Observations![0]!, /0\.10\.0 · Teammates stall after info/);
  assert.match(sections.Runs![0]!, /^triage finished · .* · attention · info does not wake$/);
});

test('r queues a finished or stuck issue for triage again, never one a worker holds', async () => {
  const fake = ops([issue('c', 'attention'), issue('t', 'triaging')]);
  const spec = signalPanelSpec(fake);
  const retry = spec.actions!.find(action => action.key === 'r')!;
  const [, attention, triaging] = spec.items();
  assert.equal(retry.when!(attention), true);
  assert.equal(retry.when!(triaging), false);
  assert.equal(retry.when!(spec.items()[0]), false, 'the triage row has nothing to retry');
  const { panel, notices } = control();
  await retry.run(attention, panel);
  assert.deepEqual(fake.retried, ['c']);
  assert.deepEqual(notices, ['Issue c: queued for the next triage.']);
});

test('signals off is visible in the summary and the triage row', () => {
  const spec = signalPanelSpec(ops([], { config: () => settings({ enabled: false }) }));
  assert.match(spec.summary!(), /triage off$/);
  assert.equal(spec.items()[0]!.meta, 'off');
  assert.equal(signalPanelSpec(ops([])).items()[0]!.meta, '03:00');
});
