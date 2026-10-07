import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createAgentSession, DefaultPackageManager, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { protectOutboundData } from '@prjct.app/pi-secrets/privacy';
import { config, stateDir } from './config.ts';
import type { SignalModel } from './schema.ts';

export type AgentTask = { cwd: string; model?: SignalModel; prompt: string; tools: ToolDefinition[]; writable: boolean; signal?: AbortSignal };
export type AgentRunner = (task: AgentTask) => Promise<void>;
export const runAgent: AgentRunner = async task => {
  const home = getAgentDir();
  const configured = SettingsManager.create(task.cwd, home, { projectTrusted: false });
  if (configured.drainErrors().length) throw new Error('Cannot read Pi settings for the signals worker.');
  const effective = configured.getSettings();
  const selected = task.model ?? (effective.defaultProvider && effective.defaultModel ? { provider: effective.defaultProvider, id: effective.defaultModel, thinkingLevel: effective.defaultThinkingLevel } : undefined);
  if (!selected) throw new Error('No originating or configured Pi model is available. Select a model in Pi.');
  const runtime = await ModelRuntime.create({ authPath: join(home, 'auth.json'), modelsPath: join(home, 'models.json'), allowModelNetwork: false });
  const model = runtime.getModel(selected.provider, selected.id);
  const manager = new DefaultPackageManager({ cwd: task.cwd, agentDir: home, settingsManager: configured });
  const admitted = config().workerPackages;
  const paths = manager.listConfiguredPackages().flatMap(pkg => {
    if (!pkg.installedPath) return [];
    const manifest = JSON.parse(readFileSync(join(pkg.installedPath, 'package.json'), 'utf8'));
    return admitted.includes(manifest.name) ? (manifest.pi?.extensions ?? []).map((entry: string) => join(pkg.installedPath!, entry)) : [];
  });
  const settings = SettingsManager.inMemory({ ...effective, packages: [], extensions: [], cacheWarming: 'off' });
  const loader = new DefaultResourceLoader({ cwd: task.cwd, agentDir: home, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: paths });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error('The worker could not load the admitted Pi extensions.');
  const { session } = await createAgentSession({ cwd: task.cwd, agentDir: home, settingsManager: settings, resourceLoader: loader,
    modelRuntime: runtime, model, thinkingLevel: selected.thinkingLevel, sessionManager: SessionManager.create(task.cwd, join(stateDir(), 'sessions')),
    tools: ['read', 'grep', 'find', 'ls', 'bash', ...(task.writable ? ['edit', 'write'] : []), 'context_status', 'context_history', 'context_compact', ...task.tools.map(tool => tool.name)], customTools: task.tools });
  const abort = () => { void session.abort(); };
  task.signal?.addEventListener('abort', abort, { once: true });
  try {
    task.signal?.throwIfAborted();
    await session.bindExtensions({ mode: 'rpc' });
    const resolved = runtime.getModel(selected.provider, selected.id);
    if (!resolved) throw new Error(`The originating model ${selected.provider}/${selected.id} is unavailable; no substitute was selected.`);
    await session.setModel(resolved);
    if (selected.thinkingLevel) session.setThinkingLevel(selected.thinkingLevel);
    await session.prompt(await protectOutboundData(task.prompt));
    task.signal?.throwIfAborted();
  } finally {
    task.signal?.removeEventListener('abort', abort);
    await session.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' });
    session.dispose();
  }
};
