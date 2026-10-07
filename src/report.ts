import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { contentText } from '@earendil-works/pi-ai';
import { VERSION, type ExtensionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { OBSERVATION, type Capture, type ReportInput, type Target } from './schema.ts';

export const entryText = (entry: SessionEntry): string => {
  if (entry.type === 'message' && 'content' in entry.message) return contentText(entry.message.content);
  if (entry.type === 'custom_message') return contentText(entry.content);
  if (entry.type === 'custom' && entry.customType === OBSERVATION) return JSON.stringify(entry.data);
  return '';
};

export function prepareReport(input: ReportInput, target: Target, ctx: ExtensionContext): Capture {
  if (!input.title.trim() || !input.signature.trim() || !input.expected.trim() || !input.actual.trim()
    || !input.steps.length || input.steps.some(step => !step.trim()) || !input.evidence.length) throw new Error('Include a title, stable defect signature, reproduction steps, expected and actual results, and evidence.');
  const branch = ctx.sessionManager.getBranch();
  const evidence = input.evidence.map(item => {
    const entry = branch.findLast(entry => (!item.entryId || entry.id === item.entryId) && entryText(entry).includes(item.quote));
    if (!entry) throw new Error('Evidence must quote an original entry on this session branch. Inspect observations or use context_history to recover the exact text.');
    const source = entry.type === 'message' ? entry.message.role : entry.type;
    return { source, quote: item.quote, entryId: entry.id };
  });
  if (input.reproduced && !evidence.some(item => item.source === 'toolResult' || item.source === 'custom')) throw new Error('A reproduced defect needs tool or native SDK evidence; a claim in prose alone is not execution evidence.');
  const signature = input.signature.trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const id = hash([target.id, signature]);
  const observationId = hash([id, ctx.sessionManager.getSessionId(), evidence.map(item => item.entryId), evidence.map(item => item.quote)]);
  const quote = (value: string) => value.split('\n').map(line => `> ${line}`).join('\n');
  const body = [
    `## Observed problem\n\n${input.actual}`,
    `## Expected behavior\n\n${input.expected}`,
    `## Reproduction\n\nStatus: ${input.reproduced ? 'reproduced by the reporting agent' : 'observed; reproduction not independently confirmed'}.\n\n${input.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
    `## Evidence\n\n${evidence.map(item => `Source: ${item.source}\n\n${quote(item.quote)}`).join('\n\n')}`,
    `## Environment\n\n- Component: ${target.id}@${target.version}\n- Pi: ${VERSION}\n- Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : 'unavailable'}\n- Reasoning: ${ctx.thinkingLevel ?? 'unspecified'}\n- Node: ${process.version}\n- Platform: ${process.platform}/${process.arch}\n- Category: ${input.category}`,
    input.measurements ? `## Measurements\n\n${JSON.stringify(input.measurements)}` : '',
    'Recorded by the active Pi agent from selected evidence. Triage must evaluate causality and reproducibility; this signal does not establish a general change in model intelligence.',
  ].filter(Boolean).join('\n\n');
  return { id, observationId, component: target.id, version: target.version, category: input.category, payload: { title: input.title.trim(), body },
    model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, thinkingLevel: ctx.thinkingLevel } : undefined };
}

/** Publication uses a minimal report, never a copied transcript or automatic file attachments. */
export function hideLocalPaths<T>(value: T, cwd: string): T {
  const serialized = JSON.stringify(value);
  const paths = new Map([[homedir(), '<home>'], [cwd, '<workspace>']]);
  const protectedText = [...paths].filter(([path]) => path.length > 1).sort(([a], [b]) => b.length - a.length)
    .reduce((text, [path, label]) => text.replaceAll(JSON.stringify(path).slice(1, -1), label), serialized);
  return JSON.parse(protectedText) as T;
}
