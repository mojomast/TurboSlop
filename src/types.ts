/**
 * TurboSlop — the type contract.
 *
 * Everything the tool produces is validated against these schemas. This mirrors
 * the guarantee Jev gives on its side of the wire: an answer can never contain a
 * value outside the schema we declared. Here we enforce the same property on the
 * decision *document* that flows through the rest of the pipeline, so a malformed
 * decision is caught at the boundary rather than inside the renderer.
 *
 * A design spec is only ever built from:
 *   - ids that exist in catalog.ts, and
 *   - numbers that came back from Jev (or the local stand-in).
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Axes — the independent dimensions a design direction is composed of.
 * One Jev question per axis (one judgment per question).
 * ------------------------------------------------------------------ */
export const AXES = ['emotion', 'composition', 'effects', 'palette', 'typography', 'layout', 'motion', 'density'] as const;
export type Axis = (typeof AXES)[number];

/* ------------------------------------------------------------------ *
 * Jev answer shapes — mirror of the wire format.
 *   noul  : P(yes)
 *   choice: the winning option + full distribution + confidence
 *   score : probability-weighted mean + legend + distribution + confidence
 * ------------------------------------------------------------------ */
export const NoulAnswer = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
});

export const ChoiceAnswer = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.number().min(0).max(1)),
});

export const ScoreAnswer = z.object({
  type: z.literal('score'),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  legend: z.record(z.string()),
  probabilities: z.record(z.number().min(0).max(1)),
});

export const JevAnswer = z.discriminatedUnion('type', [NoulAnswer, ChoiceAnswer, ScoreAnswer]);

/** Raw envelope returned by POST /v1/systemone (and by the local stand-in). */
export const JevResponse = z.object({
  model: z.string(),
  answers: z.record(JevAnswer),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});
export type JevResponse = z.infer<typeof JevResponse>;

/* ------------------------------------------------------------------ *
 * Per-axis decision record — kept richer than "we picked X".
 * The full distribution and confidence are retained so a human can audit
 * *why* the tool chose something, and so thresholds can be retuned later
 * without re-running the model.
 * ------------------------------------------------------------------ */
export const AxisDecision = z.object({
  axis: z.enum(AXES),
  kind: z.enum(['choice', 'score']),
  /** The selected catalog id. */
  picked: z.string(),
  /** All candidates, ranked (desc) by their fit score. */
  ranked: z.array(z.object({ id: z.string(), score: z.number(), normalized: z.number() })),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.number().min(0).max(1)),
  /** True when confidence fell below the axis threshold -> human review. */
  review: z.boolean(),
  rationale: z.string(),
});
export type AxisDecision = z.infer<typeof AxisDecision>;

/* ------------------------------------------------------------------ *
 * Content — the whole content model, written by the LLM from the brief.
 *
 * Jev chose the design; this is everything the page SAYS. Defined in
 * `content.ts` so the schema, the fallback specimen and the emphasis
 * convention live together.
 * ------------------------------------------------------------------ */
export { Content, Section, Item, Stat, Feature, Fact } from './content.js';
import { Content } from './content.js';

/* ------------------------------------------------------------------ *
 * Generated art — 256x256 PNGs produced by the Supra2 service.
 *
 * Illustrative, not authoritative: the design works without them.
 * `file` is relative to the output directory so a generated page stays
 * portable next to its assets folder.
 * ------------------------------------------------------------------ */
export const Asset = z.object({
  kind: z.enum(['surface', 'motif', 'backdrop']),
  file: z.string(),
  alt: z.string(),
  /** The exact prompt used, so a result can be reproduced or audited. */
  prompt: z.string().default(''),
  seed: z.number(),
  steps: z.number(),
  cfg: z.number(),
  bytes: z.number().default(0),
  seconds: z.number().default(0),
});
export type Asset = z.infer<typeof Asset>;

/* ------------------------------------------------------------------ *
 * The design spec — the single artefact the whole pipeline agrees on.
 * ------------------------------------------------------------------ */
export const DeciderKind = z.enum(['live', 'local']);

export const DesignSpec = z.object({
  version: z.literal(1),
  brief: z.string().min(1),
  /** Ordered, most-significant first. Each picks a catalog id. */
  decisions: z.array(AxisDecision),
  /** Composite score across axes, weights owned in code (questions.ts). */
  composite: z.object({
    score: z.number(),
    normalized: z.number(),
    weights: z.record(z.number()),
  }),
  /** Axes whose confidence fell below threshold — surface these to the user. */
  review: z.array(z.enum(AXES)),
  /** Prose written by the LLM, when one is configured. */
  content: Content.optional(),
  /** Artwork generated by the image service, when it was enabled. */
  assets: z.array(Asset).default([]),
  meta: z.object({
    decider: DeciderKind,
    model: z.string(),
    latencyMs: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    /** Estimated USD for this decision, from published Jev pricing. */
    estimatedUsd: z.number(),
    /** Which writer produced `content`, and with what. */
    writer: z.string().default('none'),
    writerModel: z.string().default('none'),
    writerLatencyMs: z.number().default(0),
    writerInputTokens: z.number().default(0),
    writerOutputTokens: z.number().default(0),
    /** Of the output tokens, how many were spent thinking. */
    writerReasoningTokens: z.number().default(0),
    /** Estimated USD for the writing half. Dominates the total. */
    writerEstimatedUsd: z.number().default(0),
    /** Image generation summary. */
    imageSteps: z.number().default(0),
    imageCfg: z.number().default(0),
    imageCount: z.number().default(0),
    imageMs: z.number().default(0),
  }),
  /** Flattened id -> value map, convenient for the renderer. */
  tokens: z.record(z.string()),
});
export type DesignSpec = z.infer<typeof DesignSpec>;
