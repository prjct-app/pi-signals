import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { runAgent } from '../src/agent.ts';
import { stateDir } from '../src/config.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// This test writes a fixture settings file and worker config. They must never land in the user's real Pi or prjct folders.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'signals-agent-home-'));
process.env.PRJCT_HOME = mkdtempSync(join(tmpdir(), 'signals-prjct-home-'));
import { temp, write } from './helpers.ts';

/** A call counter: the only mutable state here, behind tick() and count(). */
const counter = () => {
  const calls: true[] = [];
  return { tick: () => { calls.push(true); }, count: () => calls.length };
};

test('real public SDK worker loads an admitted provider and preserves model, reasoning and native settings', async () => {
  const home = getAgentDir(), root = temp(), extension = join(root, 'provider'), trace = join(root, 'trace.json');
  write(join(extension, 'package.json'), JSON.stringify({ name: '@fixture/provider', version: '1.0.0', type: 'module', pi: { extensions: ['./index.ts'] } }));
  write(join(extension, 'index.ts'), `
import {writeFileSync} from 'node:fs';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
export default function fixture(pi){
 const calls = [];
 pi.registerProvider('signals-fixture',{baseUrl:'https://invalid.invalid',apiKey:'offline',api:'signals-fixture-api',models:[{id:'fixture',name:'Fixture',api:'signals-fixture-api',reasoning:true,contextWindow:1000000,maxTokens:128000,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model,context,options){
  calls.push(1); const done=context.messages.some(m=>m.role==='toolResult'&&m.toolName==='fixture_result');
  writeFileSync(${JSON.stringify(trace)},JSON.stringify({calls: calls.length,model:model.id,provider:model.provider,reasoning:options.reasoning,thinkingBudgets:options.thinkingBudgets,compaction:pi.getSettings().compaction,prompt:JSON.stringify(context.messages)}));
  const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:done?[{type:'text',text:'Completed normally.'}]:[{type:'toolCall',id:'result',name:'fixture_result',arguments:{}}],stopReason:done?'stop':'toolUse',timestamp:Date.now(),usage:{input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});stream.end();});return stream;
 }});
}`);
  const compaction = { reserveTokens: 40000, keepRecentTokens: 60000 };
  write(join(home, 'settings.json'), JSON.stringify({ packages: [extension], defaultProvider: 'signals-fixture', defaultModel: 'fixture', defaultThinkingLevel: 'high', compaction, thinkingBudgets: { high: 21000 } }));
  write(join(stateDir(), 'config.json'), JSON.stringify({ workerPackages: ['@fixture/provider'] }));
  const results = counter();
  await runAgent({ cwd: root, model: { provider: 'signals-fixture', id: 'fixture', thinkingLevel: 'high' }, prompt: 'ORIGINAL_TASK: evaluate the supplied local signal without replacing the model.', writable: false,
    tools: [{ name: 'fixture_result', label: 'Fixture result', description: 'Offline result.', parameters: Type.Object({}), async execute() { results.tick(); return { content: [{ type: 'text', text: 'Saved.' }], details: {} }; } }] });
  const observed = JSON.parse(readFileSync(trace, 'utf8'));
  assert.equal(results.count(), 1); assert.equal(observed.calls, 2); assert.equal(observed.provider, 'signals-fixture'); assert.equal(observed.reasoning, 'high');
  assert.deepEqual(observed.compaction, compaction); assert.deepEqual(observed.thinkingBudgets, { high: 21000 }); assert.match(observed.prompt, /ORIGINAL_TASK/);
});
