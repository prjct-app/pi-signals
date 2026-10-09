import { SYMBOL, ago, type PanelAction, type PanelDetail, type PanelItem, type PanelSpec, type Tone } from '@prjct.app/pi-tui-kit';
import type { Config } from './config.ts';
import type { LocalIssue, Status } from './store.ts';

/** What the panel reads and the one change it can make. Each call opens and closes the store. */
export type SignalPanelOps = {
  readonly config: () => Config;
  readonly issues: () => readonly LocalIssue[];
  readonly observations: (id: string) => readonly { created: number; version: string; payload: { title: string; body: string } }[];
  readonly runs: (id: string) => readonly { phase: string; state: string; started: number; finished?: number; result?: unknown }[];
  readonly days: () => readonly { day: string; started: number; finished?: number }[];
  /** Queue an issue for triage again; false when a worker holds it. */
  readonly retry: (id: string) => boolean;
  readonly now?: () => number;
};

const TRIAGE = '__triage__';
const STATUS: Readonly<Record<Status, { word: string; short: string; symbol: string; tone: Tone; rank: number }>> = {
  attention: { word: 'needs a fix', short: 'fix', symbol: SYMBOL.attention, tone: 'warning', rank: 0 },
  blocked: { word: 'repair blocked', short: 'blocked', symbol: SYMBOL.error, tone: 'error', rank: 1 },
  needs_evidence: { word: 'needs evidence', short: 'evidence', symbol: SYMBOL.attention, tone: 'warning', rank: 2 },
  new: { word: 'waiting for triage', short: 'queued', symbol: SYMBOL.idle, tone: 'accent', rank: 3 },
  triaging: { word: 'triaging', short: 'triaging', symbol: SYMBOL.active, tone: 'accent', rank: 4 },
  repairing: { word: 'repairing', short: 'repairing', symbol: SYMBOL.active, tone: 'accent', rank: 5 },
  flaky: { word: 'flaky', short: 'flaky', symbol: SYMBOL.idle, tone: 'muted', rank: 6 },
  verified: { word: 'fix verified', short: 'verified', symbol: SYMBOL.ok, tone: 'success', rank: 7 },
  resolved: { word: 'resolved', short: 'resolved', symbol: SYMBOL.ok, tone: 'success', rank: 8 },
};
/** What still needs someone: a fix, a repair that failed, or more evidence. */
const TO_FIX: readonly Status[] = ['attention', 'blocked', 'needs_evidence'];
const RETRYABLE: readonly Status[] = ['attention', 'blocked', 'needs_evidence', 'flaky', 'verified', 'resolved'];

const at = (config: Config): string => `${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')} ${config.timezone}`;
const firstLine = (text: string): string => text.split('\n').map(line => line.trim()).find(Boolean) ?? '';
const short = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  const record = value as { status?: unknown; explanation?: unknown; verdict?: unknown };
  return [record.status ?? record.verdict, record.explanation].filter(part => typeof part === 'string' && part).join(' · ').slice(0, 200);
};

export function signalPanelSpec(ops: SignalPanelOps, initial?: string): PanelSpec {
  const now = (): number => ops.now?.() ?? Date.now();
  const sorted = (): readonly LocalIssue[] => [...ops.issues()]
    .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || b.updated - a.updated);
  const issueOf = (item: PanelItem | undefined): LocalIssue | undefined =>
    item && item.id !== TRIAGE ? ops.issues().find(issue => issue.id === item.id) : undefined;

  const triageDetail = (): PanelDetail => {
    const config = ops.config();
    const repositories = Object.entries(config.repositories);
    return {
      title: 'Daily triage',
      subtitle: config.enabled ? `runs every day at ${at(config)}` : 'off: signals are disabled in the global configuration',
      subtitleTone: config.enabled ? 'muted' : 'warning',
      fields: [
        { label: 'Signals', value: config.enabled ? 'on' : 'off', tone: config.enabled ? 'success' : 'warning' },
        { label: 'Repair', value: config.repair ? 'on: verified fixes are prepared in a worktree' : 'off: triage only' },
        { label: 'Watching', value: config.packages.length ? config.packages.join(', ') : 'Pi and installed extensions' },
        { label: 'Repositories', value: repositories.length ? repositories.map(([name, repo]) => `${name} (${repo.base})`).join(', ') : 'none configured' },
      ],
      sections: [
        { title: 'Recent days', lines: ops.days().map(day => `${day.day}  ${day.finished ? `finished ${ago(day.finished, now())}` : `started ${ago(day.started, now())}, not finished`}`) },
        ...(ops.issues().length ? [] : [{ title: 'No issues yet', lines: [
          'When Pi or an installed extension shows a latency regression, a crash or a concrete response-quality regression, the agent can record it with signal_report.',
          'Recorded issues appear here and are triaged daily.',
        ] }]),
      ],
    };
  };

  const issueDetail = (issue: LocalIssue): PanelDetail => {
    const status = STATUS[issue.status];
    const observations = [...ops.observations(issue.id)].sort((a, b) => b.created - a.created).slice(0, 5);
    const runs = [...ops.runs(issue.id)].sort((a, b) => b.started - a.started).slice(0, 5);
    return {
      title: issue.title,
      subtitle: `${issue.component} · ${issue.category}`,
      fields: [
        { label: 'Status', value: status.word, tone: status.tone },
        { label: 'Seen', value: `${issue.sightings} ${issue.sightings === 1 ? 'time' : 'times'}` },
        { label: 'First seen', value: ago(issue.created, now()) },
        { label: 'Updated', value: ago(issue.updated, now()) },
        ...(issue.model ? [{ label: 'Model', value: `${issue.model.provider}/${issue.model.id}` }] : []),
        ...(issue.lastError ? [{ label: 'Last error', value: issue.lastError, tone: 'error' as const }] : []),
      ],
      sections: [
        ...(issue.decision ? [{ title: `Triage: ${issue.decision.verdict}`, lines: [issue.decision.reason, ...issue.decision.evidence.map(line => `· ${line}`)] }] : []),
        { title: 'Observations', lines: observations.map(item => `${ago(item.created, now())} · ${item.version} · ${firstLine(item.payload.title) || firstLine(item.payload.body)}`) },
        { title: 'Runs', lines: runs.map(run => `${run.phase} ${run.state} · ${ago(run.started, now())}${short(run.result) ? ` · ${short(run.result)}` : ''}`) },
      ],
    };
  };

  const actions: PanelAction[] = [{
    key: 'r', label: 'Queue for triage again',
    when: item => { const issue = issueOf(item); return !!issue && RETRYABLE.includes(issue.status); },
    run: (item, panel) => {
      const issue = issueOf(item)!;
      const queued = ops.retry(issue.id);
      panel.notice(queued ? `${issue.title}: queued for the next triage.` : `${issue.title}: a worker is on it; try again later.`, queued ? 'success' : 'warning');
      panel.refresh();
    },
  }];

  return {
    title: 'Signals',
    summary: () => {
      const issues = ops.issues(), config = ops.config();
      const toFix = issues.filter(issue => TO_FIX.includes(issue.status)).length;
      return [`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`, `${toFix} to fix`,
        config.enabled ? `triage ${at(config)}` : 'triage off'].join(' · ');
    },
    items: () => {
      const config = ops.config();
      // The list column is narrow: the label carries what it is, the meta one short fact.
      const triage: PanelItem = { id: TRIAGE, label: 'Daily triage', symbol: config.enabled ? SYMBOL.active : SYMBOL.idle,
        tone: config.enabled ? 'success' : 'warning', meta: config.enabled ? at(config).split(' ')[0] : 'off', search: config.timezone };
      return [triage, ...sorted().map(issue => {
        const status = STATUS[issue.status];
        return { id: issue.id, label: `${issue.component} · ${issue.title}`, symbol: status.symbol, tone: status.tone,
          meta: `${status.short} · ${issue.sightings}×`, search: `${issue.category} ${issue.status} ${status.word}` };
      })];
    },
    detail: item => { const issue = issueOf(item); return issue ? issueDetail(issue) : triageDetail(); },
    actions,
    empty: 'No issues yet.',
    initial: initial ?? sorted()[0]?.id ?? TRIAGE,
  };
}
