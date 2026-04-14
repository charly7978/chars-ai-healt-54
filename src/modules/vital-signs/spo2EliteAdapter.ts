/**
 * Adapta SpO2ResultElite al contrato SpO2Result (gating + UncertaintyRouter).
 */
import type { SpO2Result } from './types';
import type { SpO2ResultElite } from './SpO2ProcessorElite';

export function mapEliteSpO2ToDetail(
  elite: SpO2ResultElite,
  calibrationState: SpO2Result['calibrationState']
): SpO2Result {
  let enabledState: SpO2Result['enabledState'];
  if (elite.enabledState === 'ENABLED_HIGH_CONF') {
    enabledState = 'ENABLED_HIGH_CONFIDENCE';
  } else if (elite.enabledState === 'ENABLED_MEDIUM_CONF') {
    enabledState = 'ENABLED_MEDIUM_CONFIDENCE';
  } else {
    enabledState = 'WITHHELD_LOW_QUALITY';
  }

  const conf01 = Math.min(1, Math.max(0, elite.confidence / 100));

  return {
    value: elite.value,
    confidence: conf01,
    quality: elite.quality,
    calibrationState,
    enabledState,
    rawR: elite.opticalMetrics.ratioR,
    medianR: elite.opticalMetrics.ratioR,
    piRed: elite.opticalMetrics.perfusionIndexRed,
    piGreen: elite.opticalMetrics.perfusionIndexGreen,
    validBeatRatios: elite.validBeatRatios,
  };
}
