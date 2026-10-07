import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, type ExtensionContext, type ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { config, type Config } from '../src/config.ts';
import type { AgentTask } from '../src/agent.ts';
import type { Capture, ReportInput } from '../src/schema.ts';

export const temp = () => mkdtempSync(join(tmpdir(), 'signals-test-'));
export const capture = (overrides: Partial<Capture> = {}): Capture => ({ id: 'a'.repeat(64), observationId: 'b'.repeat(64), component: '@prjct.app/fixture', version: '1.0.0', category: 'crash', payload: { title: 'Crash on empty input', body: 'FAIL: empty input crashed' }, model: { provider: 'fixture', id: 'model', thinkingLevel: 'high' }, ...overrides });
export const input: ReportInput = { target: '@prjct.app/fixture', title: 'Crash on empty input', signature: 'parser: empty input dereference', category: 'crash',
  reproduced: true, steps: ['Run the empty input fixture.'], expected: 'Empty input returns no records.', actual: 'Empty input throws.', evidence: [{ quote: 'FAIL: empty input crashed' }] };
export const context = (cwd = temp()) => {
  const sessionManager = SessionManager.inMemory(cwd);
  sessionManager.appendMessage({ role: 'toolResult', toolCallId: 'test', toolName: 'bash', content: [{ type: 'text', text: input.evidence[0]!.quote }], isError: true, timestamp: 1 });
  return { cwd, sessionManager, thinkingLevel: 'high', model: { provider: 'fixture', id: 'model' }, ui: { notify: () => undefined } } as unknown as ExtensionContext & { sessionManager: SessionManager };
};
export const settings = (overrides: Partial<Config> = {}): Config => ({ ...config(), ...overrides });
export const call = (task: AgentTask, name: string, args: unknown) => task.tools.find(tool => tool.name === name)!.execute('test', args, task.signal, undefined, context(task.cwd) as unknown as ExtensionToolContext);
export const write = (file: string, value: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, value); };
