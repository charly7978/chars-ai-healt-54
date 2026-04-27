import { useCallback, useEffect, useRef } from 'react';
import { VitalSignsProcessor, VitalSignsResult, RGBData } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * Hook V3 — única instancia de VitalSignsProcessor, sin API muerta.
 *
 * Eliminado de versiones anteriores:
 *  - setEvidenceContext público (se setea siempre dentro de processSignal).
 *  - lastValidResultsDebug y getDebugLastValid (sin consumidores).
 *  - hasValidPressureEstimate (sin consumidores en runtime).
 *  - debugInfo (sin consumidores).
 */
export const useVitalSignsProcessor = () => {
  const processorRef = useRef<VitalSignsProcessor | null>(null);

  if (!processorRef.current) {
    processorRef.current = new VitalSignsProcessor();
  }

  useEffect(() => {
    return () => {
      if (processorRef.current) {
        processorRef.current.fullReset();
        processorRef.current = null;
      }
    };
  }, []);

  const startCalibration = useCallback(() => {
    processorRef.current?.startCalibration();
  }, []);

  const setRGBData = useCallback((data: RGBData) => {
    processorRef.current?.setRGBData(data);
  }, []);

  const setUpstreamContext = useCallback((ctx: {
    contactStable?: boolean;
    pressureOptimal?: boolean;
    clipHighRatio?: number;
    sourceStability?: number;
    avgBeatSQI?: number;
    beatCount?: number;
  }) => {
    processorRef.current?.setUpstreamContext(ctx);
  }, []);

  const processSignal = useCallback(
    (
      value: number,
      rrData?: { intervals: number[]; lastPeakTime: number | null },
      beatInputs?: Array<{
        ibiMs: number;
        beatSQI: number;
        morphologyScore: number;
        detectorAgreement: number;
        amplitude?: number;
        flags: { isWeak: boolean; isPremature: boolean; isSuspicious: boolean; isDoublePeak: boolean };
      }>,
      livePpgEvidence?: {
        passed: boolean;
        qualityScore?: number;
        reasons?: string[];
        dominantFrequencyHz?: number;
        detectorAgreementScore?: number;
        channelCoherence?: number;
        acDc?: { r?: number; g?: number; b?: number };
        perfusionIndex?: number;
      }
    ): VitalSignsResult => {
      const defaultResult: VitalSignsResult = {
        spo2: 0,
        glucose: 0,
        pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT', featureQuality: 0 },
        arrhythmiaCount: 0,
        arrhythmiaStatus: 'NO_VALID_PPG|0',
        lipids: { totalCholesterol: 0, triglycerides: 0 },
        isCalibrating: false,
        calibrationProgress: 0,
        lastArrhythmiaData: undefined,
        signalQuality: 0,
        measurementConfidence: 'INVALID',
      };

      if (!processorRef.current) return defaultResult;

      if (livePpgEvidence) {
        processorRef.current.setEvidenceContext({
          livePpgPassed: livePpgEvidence.passed === true,
          livePpgScore: livePpgEvidence.qualityScore ?? 0,
          evidenceTier: livePpgEvidence.passed ? 'VALID_LIVE_PPG' : 'INVALID',
          bpm: 0,
          bpmConfidence: 0,
          acceptedBeats: 0,
          rrIntervals: [],
          signalQuality: 0,
          perfusionIndex: livePpgEvidence.perfusionIndex ?? 0,
          spectralDominance: 0,
          temporalSpectralAgreement: 0,
          sourceStability: 0,
          negativeControlScore: 0,
          rejectionReasons: livePpgEvidence.reasons ?? [],
        });
        if (!livePpgEvidence.passed) return defaultResult;
      }

      return processorRef.current.processSignal(value, rrData, beatInputs);
    },
    []
  );

  const reset = useCallback((): VitalSignsResult => {
    processorRef.current?.reset();
    return {
      spo2: 0,
      glucose: 0,
      pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT', featureQuality: 0 },
      arrhythmiaCount: 0,
      arrhythmiaStatus: 'NO_VALID_PPG|0',
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false,
      calibrationProgress: 0,
      lastArrhythmiaData: undefined,
      signalQuality: 0,
      measurementConfidence: 'INVALID',
    };
  }, []);

  const fullReset = useCallback(() => {
    processorRef.current?.fullReset();
  }, []);

  const setHeartRuntime = useCallback((ctx: { bpm?: number; bpmConfidence?: number; beatCount?: number }) => {
    processorRef.current?.setHeartRuntime(ctx);
  }, []);

  const ingestBeatOpticalRatio = useCallback(() => {
    processorRef.current?.ingestBeatOpticalRatio();
  }, []);

  return {
    processSignal,
    setRGBData,
    setUpstreamContext,
    setHeartRuntime,
    ingestBeatOpticalRatio,
    reset,
    fullReset,
    startCalibration,
    getCalibrationProgress: useCallback(() => processorRef.current?.getCalibrationProgress() ?? 0, []),
  };
};
