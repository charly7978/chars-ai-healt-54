import { useCallback, useRef, useState, useEffect } from 'react';
import { VitalSignsProcessor, VitalSignsResult, RGBData } from '../modules/vital-signs/VitalSignsProcessor';

/**
 * HOOK DE SIGNOS VITALES V2
 * Accepts RGB data + upstream context for gating
 */
export const useVitalSignsProcessor = () => {
  const processorRef = useRef<VitalSignsProcessor | null>(null);
  // lastValidResults SOLO para debug histórico, NUNCA para renderizar valores actuales
  const lastValidResultsDebug = useRef<VitalSignsResult | null>(null);
  const sessionId = useRef<string>(`${Date.now().toString(36)}${(performance.now() | 0).toString(36)}`);
  const processedSignals = useRef<number>(0);
  const livePpgEvidencePassed = useRef<boolean>(false);
  
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

  const setEvidenceContext = useCallback((ctx: {
    livePpgPassed: boolean;
    livePpgQuality: number;
    reasons: string[];
    dominantFrequencyHz?: number;
    detectorAgreementScore?: number;
    channelCoherence?: number;
    acDc?: { r?: number; g?: number; b?: number };
  }) => {
    processorRef.current?.setEvidenceContext({
      livePpgPassed: ctx.livePpgPassed,
      livePpgScore: ctx.livePpgQuality,
      evidenceTier: ctx.livePpgPassed ? 'VALID_LIVE_PPG' : 'INVALID',
      bpm: 0,
      bpmConfidence: 0,
      acceptedBeats: 0,
      rrIntervals: [],
      signalQuality: 0,
      perfusionIndex: ctx.acDc?.g ?? 0,
      spectralDominance: 0,
      temporalSpectralAgreement: 0,
      sourceStability: 0,
      negativeControlScore: 0,
      rejectionReasons: ctx.reasons
    });
  }, []);
  
  const processSignal = useCallback((
    value: number, 
    rrData?: { intervals: number[], lastPeakTime: number | null },
    beatInputs?: Array<{
      ibiMs: number; beatSQI: number; morphologyScore: number;
      detectorAgreement: number; amplitude?: number;
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
    }
  ): VitalSignsResult => {
    const defaultResult: VitalSignsResult = {
      spo2: 0, glucose: 0,
      pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
      arrhythmiaCount: 0, arrhythmiaStatus: "NO_VALID_PPG|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false, calibrationProgress: 0, lastArrhythmiaData: undefined,
      signalQuality: 0, measurementConfidence: 'INVALID' as const,
    };
    
    if (!processorRef.current) return defaultResult;
    
    // FAIL-CLOSED: Setear evidenceContext antes de procesar
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
        perfusionIndex: livePpgEvidence.acDc?.g ?? 0,
        spectralDominance: 0,
        temporalSpectralAgreement: 0,
        sourceStability: 0,
        negativeControlScore: 0,
        rejectionReasons: livePpgEvidence.reasons ?? []
      });
    }
    
    // FAIL-CLOSED: Si no hay evidencia PPG viva, devolver INVALID inmediatamente
    if (livePpgEvidence && !livePpgEvidence.passed) {
      livePpgEvidencePassed.current = false;
      return defaultResult;
    }
    
    processedSignals.current++;
    const result = processorRef.current.processSignal(value, rrData, beatInputs);
    
    // Solo guardar para debug histórico si hay evidencia PPG válida
    if (livePpgEvidence && livePpgEvidence.passed) {
      if (
        result.measurementConfidence !== 'INVALID' ||
        result.pressure.confidence !== 'INSUFFICIENT' ||
        result.spo2 > 0 || result.glucose > 0 ||
        result.lipids.totalCholesterol > 0 || result.arrhythmiaCount > 0
      ) {
        lastValidResultsDebug.current = result;
        livePpgEvidencePassed.current = true;
      }
    } else {
      livePpgEvidencePassed.current = false;
    }
    
    return result;
  }, []);

  const reset = useCallback(() => {
    // FAIL-CLOSED: reset() SIEMPRE devuelve INVALID, nunca último resultado válido
    if (!processorRef.current) {
      return {
        spo2: 0, glucose: 0,
        pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
        arrhythmiaCount: 0, arrhythmiaStatus: "NO_VALID_PPG|0",
        lipids: { totalCholesterol: 0, triglycerides: 0 },
        isCalibrating: false, calibrationProgress: 0, lastArrhythmiaData: undefined,
        signalQuality: 0, measurementConfidence: 'INVALID' as const,
      };
    }
    processorRef.current.reset();
    livePpgEvidencePassed.current = false;
    return {
      spo2: 0, glucose: 0,
      pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
      arrhythmiaCount: 0, arrhythmiaStatus: "NO_VALID_PPG|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false, calibrationProgress: 0, lastArrhythmiaData: undefined,
      signalQuality: 0, measurementConfidence: 'INVALID' as const,
    };
  }, []);

  const fullReset = useCallback(() => {
    processorRef.current?.fullReset();
    lastValidResultsDebug.current = null;
    livePpgEvidencePassed.current = false;
    processedSignals.current = 0;
  }, []);

  const hasValidPressureEstimate = useCallback(() => {
    return processorRef.current?.hasValidPressureEstimate() ?? false;
  }, []);

  const setHeartRuntime = useCallback((ctx: { bpm?: number; bpmConfidence?: number; beatCount?: number }) => {
    processorRef.current?.setHeartRuntime(ctx);
  }, []);

  const ingestBeatOpticalRatio = useCallback(() => {
    processorRef.current?.ingestBeatOpticalRatio();
  }, []);

  return {
    processSignal,
    setEvidenceContext,
    setRGBData,
    setUpstreamContext,
    setHeartRuntime,
    ingestBeatOpticalRatio,
    reset,
    fullReset,
    startCalibration,
    hasValidPressureEstimate,
    // NO exportar lastValidResults - solo para debug interno
    getDebugLastValid: useCallback(() => lastValidResultsDebug.current, []),
    getCalibrationProgress: useCallback(() => processorRef.current?.getCalibrationProgress() ?? 0, []),
    debugInfo: {
      processedSignals: processedSignals.current,
      sessionId: sessionId.current,
      livePpgEvidencePassed: livePpgEvidencePassed.current
    },
  };
};
