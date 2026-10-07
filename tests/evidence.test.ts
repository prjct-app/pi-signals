import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { evidenceTool } from '../src/evidence.ts';

test('evidence reads only the requested page and all original observations remain reachable', async () => {
  const all = Array.from({ length: 57 }, (_, id) => ({ id, payload: { body: `Original observation ${id}: retain the exact constraint.` } }));
  const requests: number[][] = [];
  const reader = evidenceTool((offset, limit) => { requests.push([offset, limit]); return all.slice(offset, offset + limit); });
  assert.equal(requests.length, 0);
  const seen: number[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    const result = await reader.tool.execute('read', { offset, limit: 7 }, undefined, undefined, {} as ExtensionToolContext);
    const page = JSON.parse((result.content[0] as { text: string }).text);
    seen.push(...page.items.map((item: { id: number }) => item.id)); offset = page.nextOffset;
  }
  assert.deepEqual(seen, all.map(item => item.id)); assert(requests.every(([, limit]) => limit === 8));
  assert(reader.contains('Original observation 56')); assert(!reader.contains('Fabricated observation'));
});
