import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { protectOutboundData } from '@prjct.app/pi-secrets/privacy';
import { config, targets, databasePath } from './config.ts';
import { hideLocalPaths, prepareReport } from './report.ts';
import { InspectSchema, OBSERVATION, ReportSchema } from './schema.ts';
import { SignalStore } from './store.ts';
import { rememberHost } from './host.ts';

const defaults = { config, targets, protect: protectOutboundData, databasePath };
export type SignalsDependencies = Partial<typeof defaults>;
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
const page = <T>(rows: T[], offset: number) => ({ items: rows.slice(0, 20), nextOffset: rows.length > 20 ? offset + 20 : null });
export function installSignals(pi: ExtensionAPI, dependencies: SignalsDependencies = {}) {
  const deps = { ...defaults, ...dependencies };
  pi.on('session_start', () => { try { rememberHost(); } catch { /* A host path hint must not interrupt an active session. */ } });
  const catalog = (ctx: ExtensionContext) => {
    const settings = deps.config();
    if (!settings.enabled) throw new Error('Signals is disabled by global configuration.');
    return deps.targets(pi, ctx, settings);
  };
  pi.registerTool({
    name: 'signal_report', label: 'Record failure signal',
    description: 'Record a local issue in the global .prjct database for an installed extension or Pi: latency regression, crash, or concrete response-quality regression. Supply a stable defect signature, exact session evidence, reproduction steps, expected and actual behavior. No GitHub or model request occurs during capture.',
    promptGuidelines: ['When you detect a latency regression, crash, or concrete response-quality regression in Pi or an installed extension, record minimal evidence with signal_report, then continue the original task. Use signal_inspect for targets. Detection is a signal, not proof of causality; the active agent and later triage decide.'],
    parameters: ReportSchema,
    async execute(_id, input, _signal, _update, ctx) {
      const target = catalog(ctx).find(target => target.id === input.target);
      if (!target) throw new Error('Unknown component. Inspect targets before recording a signal.');
      const capture = prepareReport(input, target, ctx);
      const payload = await deps.protect(hideLocalPaths(capture.payload, ctx.cwd));
      const store = new SignalStore(deps.databasePath());
      try { return result(store.capture({ ...capture, payload })); } finally { store.close(); }
    },
  });
  pi.registerTool({
    name: 'signal_inspect', label: 'Inspect failure signals',
    description: 'Read targets, local issues, or observations. For stored issue observations supply issueId; otherwise observations are native failures on this session branch. Paginated; no external calls.',
    parameters: InspectSchema,
    async execute(_id, input, _signal, _update, ctx) {
      const allowed = catalog(ctx), offset = input.offset ?? 0;
      if (input.action === 'targets') return result(page(allowed.slice(offset, offset + 21), offset));
      if (input.action === 'observations' && !input.issueId) {
        const entries = ctx.sessionManager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === OBSERVATION).reverse();
        return result(page(entries.slice(offset, offset + 21).map(entry => ({ entryId: entry.id, data: entry.type === 'custom' ? entry.data : undefined })), offset));
      }
      const store = new SignalStore(deps.databasePath());
      try { return result(page<unknown>(input.action === 'issues' ? store.list(offset) : store.observations(input.issueId!, offset), offset)); }
      finally { store.close(); }
    },
  });
  pi.registerCommand('signals', {
    description: 'Show local issues and daily triage configuration',
    async handler(_args, ctx) {
      try {
        const settings = deps.config(), store = new SignalStore(deps.databasePath());
        try { ctx.ui.notify(JSON.stringify({ enabled: settings.enabled, daily: `${settings.hour}:${String(settings.minute).padStart(2, '0')} ${settings.timezone}`, issues: page(store.list(), 0) }), 'info'); }
        finally { store.close(); }
      } catch { ctx.ui.notify('Cannot read signals configuration or database.', 'error'); }
    },
  });
  pi.on('session_compact_failed', async (event, ctx) => {
    if (event.aborted) return;
    try {
      if (!deps.config().enabled) return;
      pi.appendEntry(OBSERVATION, await deps.protect(hideLocalPaths({ reason: event.reason, error: event.errorMessage ?? 'Compaction failed',
        fromExtension: event.fromExtension, willRetry: event.willRetry, time: Date.now() }, ctx.cwd)));
    } catch { /* A failed observer never interrupts recovery or stores unprotected evidence. */ }
  });
}
export default installSignals;
