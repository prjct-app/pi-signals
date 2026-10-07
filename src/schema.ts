import { Type, type Static } from 'typebox';

const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
export const ReportSchema = Type.Object({
  target: text(150),
  title: text(160),
  signature: text(240),
  category: Type.Union([Type.Literal('latency'), Type.Literal('crash'), Type.Literal('response-quality')]),
  steps: Type.Array(text(2000), { minItems: 1, maxItems: 20 }),
  reproduced: Type.Boolean(),
  expected: text(4000),
  actual: text(4000),
  evidence: Type.Array(Type.Object({ quote: Type.String({ minLength: 4, maxLength: 2000 }), entryId: Type.Optional(text(150)) }), { minItems: 1, maxItems: 8 }),
  measurements: Type.Optional(Type.Object({ metric: text(150), unit: text(40), baseline: Type.Array(Type.Number({ minimum: 0 }), { minItems: 1, maxItems: 100 }), observed: Type.Array(Type.Number({ minimum: 0 }), { minItems: 1, maxItems: 100 }) })),
}, { additionalProperties: false });
export type ReportInput = Static<typeof ReportSchema>;
export const InspectSchema = Type.Object({
  action: Type.Union([Type.Literal('targets'), Type.Literal('issues'), Type.Literal('observations')]),
  issueId: Type.Optional(text(64)),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export type Target = { id: string; version: string };
export type Payload = { title: string; body: string };
export const OBSERVATION = 'signal-observation';
export type SignalModel = { provider: string; id: string; thinkingLevel?: import('@earendil-works/pi-coding-agent').ExtensionContext['thinkingLevel'] };
export type Capture = { id: string; observationId: string; component: string; version: string; category: ReportInput['category']; payload: Payload; model?: SignalModel };
export const TriageSchema = Type.Object({
  verdict: Type.Union([Type.Literal('attention'), Type.Literal('flaky'), Type.Literal('needs_evidence')]),
  reason: text(6000), evidence: Type.Array(text(4000), { minItems: 1, maxItems: 20 }),
}, { additionalProperties: false });
export type Triage = Static<typeof TriageSchema>;
