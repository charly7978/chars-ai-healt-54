/**
 * SQI por latido a partir de morfología y contexto (sin heurísticas triviales).
 */

export interface BeatQualityInput {
  prominence: number;
  widthMs: number;
  upSlope: number;
  downSlope: number;
  refractoryOk: boolean;
  templateCorrelation: number;
  ibiMs: number;
  prevIbiMs: number;
  motionPenalty: number;
  clipPenalty: number;
}

export interface BeatQualityOutput {
  score01: number;
  score0100: number;
  reasons: string[];
}

export class BeatQualityAssessor {
  static assess(input: BeatQualityInput): BeatQualityOutput {
    const reasons: string[] = [];
    let s = 0;

    const prom = Math.min(1, input.prominence / 10);
    s += prom * 0.28;
    if (prom < 0.18) reasons.push('pico poco prominente');

    const wOk = input.widthMs >= 70 && input.widthMs <= 420 ? 1 : 0.35;
    s += wOk * 0.14;
    if (wOk < 0.9) reasons.push('ancho implausible');

    const slope = Math.min(1, (input.upSlope + input.downSlope) / 10);
    s += slope * 0.18;
    if (input.upSlope < 0.35) reasons.push('subida débil');

    s += input.refractoryOk ? 0.12 : 0;
    if (!input.refractoryOk) reasons.push('refractario dudoso');

    const tpl = Math.max(0, Math.min(1, input.templateCorrelation));
    s += tpl * 0.16;

    let ibiScore = 0.5;
    if (input.prevIbiMs > 0 && input.ibiMs > 0) {
      const ratio = input.ibiMs / input.prevIbiMs;
      if (ratio > 0.62 && ratio < 1.55) ibiScore = 1;
      else if (ratio > 0.45 && ratio < 1.85) ibiScore = 0.65;
      else reasons.push('RR irregular vs previo');
    }
    s += ibiScore * 0.12;

    s -= Math.min(0.35, input.motionPenalty * 0.35);
    s -= Math.min(0.35, input.clipPenalty * 0.35);

    const score01 = Math.max(0, Math.min(1, s));
    return {
      score01,
      score0100: Math.round(score01 * 100),
      reasons,
    };
  }
}
