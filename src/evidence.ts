import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { protectOutboundData } from '@prjct.app/pi-secrets/privacy';

export type EvidenceSource = readonly unknown[] | ((offset: number, limit: number) => unknown[]);
/** Keep full observations in storage; the deciding agent chooses which pages to read. */
export function evidenceTool(source: EvidenceSource) {
  // The one cell that changes: it holds the current list, which is always replaced, never edited.
  const seen: { items: readonly string[] } = { items: [] };
  const tool: ToolDefinition = {
    name: 'signal_evidence', label: 'Read original signal evidence',
    description: 'Read original issue observations by page. Nothing is discarded; follow nextOffset to inspect all sightings. Select a smaller limit for large reports.',
    parameters: Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }),
    async execute(_id, raw) {
      const input = raw as { offset?: number; limit?: number }, offset = input.offset ?? 0, limit = input.limit ?? 1;
      const rows = typeof source === 'function' ? source(offset, limit + 1) : source.slice(offset, offset + limit + 1);
      const items = await protectOutboundData(rows.slice(0, limit));
      const additions: string[] = [];
      for (const item of items) {
        const payload = (item as { payload?: { body?: string } }).payload;
        additions.push(payload?.body ?? JSON.stringify(item));
      }
      if (additions.length) seen.items = [...seen.items, ...additions];
      return { content: [{ type: 'text', text: JSON.stringify({ items, nextOffset: rows.length > limit ? offset + limit : null }) }], details: {} };
    },
  };
  return { tool, contains: (quote: string) => seen.items.some(text => text.includes(quote)) };
}
