import { useCallback, useEffect, useRef } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';
import type { ContactState } from '../types/signal';
import type { HeartBeatResult } from '../types/beat';

/**
 * HOOK DE PROCESAMIENTO CARDÍACO V3 — sin estado React duplicado.
 *
 * El BPM, calidad y confianza visibles para el operador viven en Index.tsx
 * (que los compone después de validación cromática y cross-check espectral).
 * Este hook solo expone:
 *  - processSignal(): wrapper sobre HeartBeatProcessor.processSignal
 *  - reset()
 *  - setArrhythmiaState(): bandera interna que el procesador usa para
 *    ajustar tolerancias en presencia de arritmia confirmada.
 *
 * NO se publican setState aquí: era una de las causas de re-renders y
 * potenciales conflictos de "fuente de verdad" del BPM.
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const processingActiveRef = useRef<boolean>(false);
  const lastProcessTimeRef = useRef<number>(0);
  const noContactFramesRef = useRef<number>(0);
  const NO_CONTACT_RESET_THRESHOLD = 90;

  useEffect(() => {
    processorRef.current = new HeartBeatProcessor();
    processingActiveRef.current = true;
    return () => {
      if (processorRef.current) {
        processorRef.current.dispose();
        processorRef.current = null;
      }
      processingActiveRef.current = false;
    };
  }, []);

  const emptyResult = useCallback((): HeartBeatResult => ({
    bpm: 0,
    bpmConfidence: 0,
    isPeak: false,
    filteredValue: 0,
    arrhythmiaCount: 0,
    sqi: 0,
    beatSQI: 0,
    rrData: { intervals: [], lastPeakTime: null },
    hypothesis: null,
    detectorAgreement: 0,
    rejectionReason: '',
    beatFlags: null,
    debug: {
      instantBpm: 0,
      medianRRBpm: 0,
      autocorrBpm: 0,
      spectralBpm: 0,
      lastBeatSQI: 0,
      detectorAgreement: 0,
      expectedRR: 0,
      refractoryState: 'open',
      beatsAccepted: 0,
      beatsRejected: 0,
      lastRejectionReason: '',
      doublePeakCount: 0,
      missedBeatCount: 0,
      suspiciousCount: 0,
      templateCorrelation: 0,
      morphologyScore: 0,
      consecutivePeaks: 0,
    },
  }), []);

  const processSignal = useCallback(
    (
      value: number,
      contactState: ContactState = 'STABLE_CONTACT',
      timestamp?: number,
      upstreamContext?: {
        quality?: number;
        contactState?: string;
        motionArtifact?: boolean;
        pressureState?: string;
        clipHigh?: number;
        clipLow?: number;
        activeSource?: string;
        perfusionIndex?: number;
        positionDrifting?: boolean;
        windowSQI?: number;
        fingerMeasurementState?: string;
        effectiveSampleRate?: number;
        phaseAlignmentQuality?: number;
        spectralQualityAggregate?: number;
        livePpgEvidencePassed?: boolean;
      }
    ): HeartBeatResult => {
      if (!processorRef.current || !processingActiveRef.current) return emptyResult();

      const currentTime = timestamp ?? performance.now();

      if (contactState === 'NO_CONTACT') {
        noContactFramesRef.current += 1;
        if (noContactFramesRef.current >= NO_CONTACT_RESET_THRESHOLD) {
          processorRef.current.reset();
        }
        return emptyResult();
      }

      // Throttle leve: el procesador no necesita procesar a > 80 fps.
      if (currentTime - lastProcessTimeRef.current < 12) return emptyResult();
      lastProcessTimeRef.current = currentTime;
      noContactFramesRef.current = 0;

      return processorRef.current.processSignal(value, timestamp, upstreamContext);
    },
    [emptyResult]
  );

  const reset = useCallback(() => {
    if (processorRef.current) processorRef.current.reset();
    lastProcessTimeRef.current = 0;
    noContactFramesRef.current = 0;
  }, []);

  return {
    processSignal,
    reset,
  };
};
