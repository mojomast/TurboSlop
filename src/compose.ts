/**
 * turboslop — composition.
 *
 * Turns raw answers into a validated `DesignSpec`.
 *
 * This is where the two Jev best-practices that matter most are actually
 * applied, in code rather than in a prompt:
 *
 *  - COMPOSITE SCORING: the overall confidence of a direction is a weighted sum
 *    of per-axis confidences, with weights owned here. Changing "make emotion
 *    matter more" is a number in questions.ts, not a prompt rewrite.
 *
 *  - CONFIDENCE GATING: any axis below its threshold is flagged for review and
 *    its ranked alternatives are surfaced, instead of silently shipping a guess.
 *    We never pretend to know something the model told us it was unsure about.
 *
 * A `Choice` answer already carries `probabilities`, which IS a ranking, so we
 * get ordering for free without a second round of per-candidate Score questions.
 */
import {
  AXIS_CANDIDATE_IDS,
  AXIS_QUESTION_IDS,
  JEV_USD_PER_MTOKEN_INPUT,
  THRESHOLDS,
  WEIGHTS,
} from './questions.js';
import { DENSITY_IDS } from './catalog.js';
import type { Axis, DesignSpec } from './types.js';
import type { DecideResult } from './decider.js';

export class ComposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposeError';
  }
}

/** Guardrail thresholds — deliberately simple and readable. */
const GUARDRAIL_FLOOR = 0.6;

/** Is a palette intrinsically light? Cheap luminance read on the ground. */
function isLightGround(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Rec. 709 relative luminance, good enough for a guardrail heuristic.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

function describe(ranked: { id: string; score: number }[], picked: string, confidence: number): string {
  const rest = ranked.filter((r) => r.id !== picked).slice(0, 3);
  const tail = rest.length
    ? ` Next: ${rest.map((r) => `${r.id} (${r.score.toFixed(2)})`).join(', ')}.`
    : '';
  return `Selected "${picked}" at confidence ${confidence.toFixed(2)}.${tail}`;
}

export interface ComposeResult {
  spec: DesignSpec;
  /** Human-readable notes, including guardrail outcomes. */
  notes: string[];
}

export function compose(brief: string, result: DecideResult): ComposeResult {
  const { response, kind, latencyMs } = result;
  const notes: string[] = [];
  const decisions: DesignSpec['decisions'] = [];
  const review: Axis[] = [];

  for (const { axis, id } of AXIS_QUESTION_IDS) {
    const answer = response.answers[id];
    if (!answer) {
      // Speculative fan-out means we asked; a missing answer is a real problem.
      throw new ComposeError(`Jev returned no answer for axis "${axis}" (question id "${id}")`);
    }

    const allowed = new Set(AXIS_CANDIDATE_IDS[axis]);
    let picked: string;
    let ranked: { id: string; score: number; normalized: number }[];
    let confidence: number;
    let probabilities: Record<string, number>;

    if (answer.type === 'choice') {
      if (!allowed.has(answer.choice)) {
        // Jev cannot return an out-of-schema value; if this fires, our catalog
        // and our criteria have drifted apart.
        throw new ComposeError(
          `Axis "${axis}" returned "${answer.choice}", which is not in the catalog. ` +
            `Catalog/сriteria drift detected.`,
        );
      }
      picked = answer.choice;
      confidence = answer.confidence;
      probabilities = answer.probabilities;
      ranked = Object.entries(probabilities)
        .filter(([cid]) => allowed.has(cid))
        .map(([cid, p]) => ({ id: cid, score: p, normalized: p }))
        .sort((a, b) => b.score - a.score);
    } else if (answer.type === 'score') {
      // Density is a degree: map the position on the scale onto the nearest id.
      const clamped = Math.max(0, Math.min(2, answer.score));
      const idx = Math.round(clamped);
      picked = DENSITY_IDS[idx] ?? 'balanced';
      confidence = answer.confidence;
      probabilities = answer.probabilities;
      ranked = DENSITY_IDS.map((cid, i) => {
        const p = answer.probabilities[String(i)] ?? 0;
        return { id: cid, score: p, normalized: p };
      }).sort((a, b) => b.score - a.score);
      notes.push(
        `Density scored ${answer.score.toFixed(2)} on a 0-2 scale \u2192 "${picked}".`,
      );
    } else {
      throw new ComposeError(`Axis "${axis}" received a noul answer, which is not composable here.`);
    }

    const flagged = confidence < THRESHOLDS[axis];
    if (flagged) review.push(axis);

    decisions.push({
      axis,
      kind: answer.type,
      picked,
      ranked,
      confidence,
      probabilities,
      review: flagged,
      rationale: describe(ranked, picked, confidence),
    });
  }

  /* ---- composite score: weighted confidence, weights owned in questions.ts ---- */
  const totalWeight = decisions.reduce((sum, d) => sum + (WEIGHTS[d.axis] ?? 0), 0) || 1;
  const weighted = decisions.reduce((sum, d) => sum + (WEIGHTS[d.axis] ?? 0) * d.confidence, 0);
  const normalized = weighted / totalWeight;

  /* ---- guardrails, asked in the same batch so they cost one round-trip ---- */
  const wantsDark = response.answers.wants_dark_ground;
  const needsContrast = response.answers.needs_high_contrast;

  const paletteDecision = decisions.find((d) => d.axis === 'palette')!;
  const chosenPaletteId = paletteDecision.picked;

  if (wantsDark && wantsDark.type === 'noul' && wantsDark.noul > GUARDRAIL_FLOOR) {
    notes.push(`Brief implies a dark ground (P=${wantsDark.noul.toFixed(2)}).`);
  }
  if (needsContrast && needsContrast.type === 'noul' && needsContrast.noul > GUARDRAIL_FLOOR) {
    notes.push(`Accessibility-critical contrast requested (P=${needsContrast.noul.toFixed(2)}) — verify every text/background pair.`);
  }

  /* Cross-check the palette against the brief's own stated ground preference. */
  const lightPalettes = new Set(['paper-ink', 'sage-mist', 'aurora-glass', 'steel-signal', 'candy-pop', 'bone-clay']);
  const chosenIsLight = lightPalettes.has(chosenPaletteId);
  if (wantsDark && wantsDark.type === 'noul' && wantsDark.noul > GUARDRAIL_FLOOR && chosenIsLight) {
    if (!review.includes('palette')) review.push('palette');
    notes.push(
      `Conflict: the brief reads dark but palette "${chosenPaletteId}" is a light ground. Flagged for review.`,
    );
  }

  /* ---- tokens: a flat map the renderer consumes ---- */
  const tokens: Record<string, string> = {
    emotion: decisions.find((d) => d.axis === 'emotion')!.picked,
    palette: chosenPaletteId,
    typography: decisions.find((d) => d.axis === 'typography')!.picked,
    layout: decisions.find((d) => d.axis === 'layout')!.picked,
    motion: decisions.find((d) => d.axis === 'motion')!.picked,
    density: decisions.find((d) => d.axis === 'density')!.picked,
  };

  const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 };
  const estimatedUsd = (usage.input_tokens / 1_000_000) * JEV_USD_PER_MTOKEN_INPUT;

  const spec: DesignSpec = {
    version: 1,
    brief,
    decisions,
    composite: { score: weighted, normalized, weights: { ...WEIGHTS } },
    review: [...new Set(review)],
    assets: [],
    meta: {
      decider: kind,
      model: response.model,
      latencyMs,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      estimatedUsd,
      // Overwritten by the CLI once the copywriter has run.
      copyWriter: 'none',
      copyModel: 'none',
      copyLatencyMs: 0,
      copyInputTokens: 0,
      copyOutputTokens: 0,
      imageSteps: 0,
      imageCfg: 0,
      imageCount: 0,
      imageMs: 0,
    },
    tokens,
  };

  return { spec, notes };
}
