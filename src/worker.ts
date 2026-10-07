import { protectOutboundData } from '@prjct.app/pi-secrets/privacy';
import { config, databasePath, type Config } from './config.ts';
import { SignalStore } from './store.ts';
import { worktree } from './worktree.ts';
import { triage } from './triage.ts';
import { repair } from './repair.ts';

export function scheduleTime(settings: Config, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, due: Number(parts.hour) * 60 + Number(parts.minute) >= settings.hour * 60 + settings.minute };
}
const defaults = { config, databasePath, worktree, triage, repair };
export async function runDaily(scheduled: boolean, signal?: AbortSignal, dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies }, settings = deps.config();
  if (!settings.enabled) return { status: 'disabled', processed: 0 };
  const when = scheduleTime(settings), store = new SignalStore(deps.databasePath());
  const owner = store.acquire('worker', 120_000);
  if (!owner) { store.close(); return { status: 'busy', processed: 0 }; }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const heartbeat = setInterval(() => { if (!store.renew('worker', owner, 120_000)) controller.abort(new Error('Worker lease lost')); }, 30_000);
  const counts = { processed: 0 };
  try {
    if (scheduled && (!when.due || !store.due(when.day))) return { status: 'not_due', ...counts };
    store.recover(owner); store.startDay(when.day);
    for (const issue of store.pending().filter(issue => issue.status === 'new' || settings.repair)) {
      controller.signal.throwIfAborted();
      const active: { run?: string } = { run: store.begin(issue, owner, issue.status === 'attention' ? 'repair' : 'triage') };
      try {
        const repo = settings.repositories[issue.component];
        if (!repo) throw new Error(`No trusted checkout is bound to ${issue.component}. Configure repositories before triage.`);
        const tree = await deps.worktree(repo, active.run!, controller.signal);
        const observations = (offset: number, limit: number) => store.observations(issue.id, offset, limit);
        if (issue.status !== 'attention') {
          const result = await deps.triage(issue, observations, tree.path, controller.signal);
          store.finish(active.run!, result.decision.verdict, await protectOutboundData(result), result.decision);
          active.run = undefined;
          if (result.decision.verdict === 'attention' && settings.repair && store.get(issue.id)!.revision === issue.revision) {
            active.run = store.begin(store.get(issue.id)!, owner, 'repair');
          }
        }
        if (active.run && settings.repair) {
          const result = await deps.repair(store.get(issue.id)!, repo, tree.path, tree.base, observations, controller.signal);
          // Verified candidates stay local until the configured delivery stage accepts them.
          store.finish(active.run, result.status, await protectOutboundData(result));
          active.run = undefined;
        }
        counts.processed++;
      } catch (error) {
        if (active.run) store.finish(active.run, controller.signal.aborted ? 'new' : 'blocked', await protectOutboundData({ error: String(error) }));
        if (controller.signal.aborted) throw error;
      }
    }
    store.finishDay(when.day);
    return { status: 'completed', ...counts };
  } finally {
    clearInterval(heartbeat); signal?.removeEventListener('abort', abort); store.release('worker', owner); store.close();
  }
}
