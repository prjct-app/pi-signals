import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installSignals, type SignalsDependencies } from '../index.ts';
import { prepareReport } from '../src/report.ts';
import { SignalStore } from '../src/store.ts';
import { context, input, settings, temp } from './helpers.ts';

function fixture(overrides: SignalsDependencies = {}) {
  const root = temp(), path = join(root, 'signals.sqlite'), ctx = context(root);
  const tools = new Map<string, any>(), hooks = new Map<string, any>();
  installSignals({ registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: () => undefined, on: (event: string, handler: any) => hooks.set(event, handler),
    appendEntry: (name: string, data: unknown) => ctx.sessionManager.appendCustomEntry(name, data) } as unknown as ExtensionAPI,
  { config: settings, targets: () => [{ id: input.target, version: '1.0.0' }], databasePath: () => path, ...overrides });
  return { path, ctx, tools, hooks, run: (name: string, args: unknown) => tools.get(name).execute('call', args, undefined, undefined, ctx) };
}
test('capture is local, grounded, private, deduplicated and does not mutate model or history', async () => {
  const f = fixture(), secret = 'ghp_' + 'a'.repeat(36);
  const quote = `FAIL: ${secret} ${f.ctx.cwd}/file.ts person@example.com`;
  f.ctx.sessionManager.appendMessage({ role: 'toolResult', toolCallId: 'evidence', toolName: 'bash', content: [{ type: 'text', text: quote }], timestamp: 2, isError: true });
  const before = structuredClone(f.ctx.sessionManager.getBranch());
  const report = { ...input, actual: quote, evidence: [{ quote }] };
  const receipt = JSON.parse((await f.run('signal_report', report)).content[0].text);
  assert.equal(receipt.status, 'new'); assert(!receipt.duplicate);
  assert(JSON.parse((await f.run('signal_report', report)).content[0].text).duplicate);
  const store = new SignalStore(f.path);
  const stored = JSON.stringify(store.observations(receipt.id)); store.close();
  for (const privateValue of [secret, f.ctx.cwd, 'person@example.com']) assert(!stored.includes(privateValue));
  assert.deepEqual(f.ctx.sessionManager.getBranch(), before); assert.equal(f.ctx.thinkingLevel, 'high');
  assert.deepEqual([...f.hooks.keys()], ['session_start', 'session_compact_failed']); assert.equal(f.tools.size, 2);
});
test('privacy failure and unknown target save nothing', async () => {
  const f = fixture({ protect: async () => { throw new Error('vault unavailable'); } });
  await assert.rejects(f.run('signal_report', input), /vault unavailable/); assert(!existsSync(f.path));
  await assert.rejects(f.run('signal_report', { ...input, target: 'unknown' }), /Unknown component/);
});
test('exact evidence, original language and originating model are preserved', () => {
  const ctx = context(), target = { id: input.target, version: '1.0.0' };
  const report = prepareReport({ ...input, expected: 'Conservar el comportamiento anterior.' }, target, ctx);
  assert.match(report.payload.body, /Conservar el comportamiento anterior/);
  assert.equal(report.model?.thinkingLevel, 'high');
  assert.throws(() => prepareReport({ ...input, evidence: [{ quote: 'invented evidence' }] }, target, ctx), /original entry/);
  ctx.sessionManager.appendMessage({ role: 'user', content: 'I saw a crash.', timestamp: 3 });
  assert.throws(() => prepareReport({ ...input, evidence: [{ quote: 'I saw a crash.' }] }, target, ctx), /execution evidence/);
  assert.doesNotThrow(() => prepareReport({ ...input, reproduced: false, evidence: [{ quote: 'I saw a crash.' }] }, target, ctx));
});
test('native failure observations never start a model request; cancellations are ignored', async () => {
  const f = fixture();
  await f.hooks.get('session_compact_failed')({ aborted: true }, f.ctx); assert.equal(f.ctx.sessionManager.getBranch().length, 1);
  await f.hooks.get('session_compact_failed')({ aborted: false, reason: 'overflow', errorMessage: 'incomplete summary', fromExtension: false, willRetry: false }, f.ctx);
  const inspected = JSON.parse((await f.run('signal_inspect', { action: 'observations' })).content[0].text);
  assert.equal(inspected.items.length, 1); assert.equal(inspected.items[0].data.error, 'incomplete summary');
  assert(!existsSync(f.path));
});
