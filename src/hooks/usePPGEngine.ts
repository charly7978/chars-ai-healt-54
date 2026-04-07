/**
 * usePPGEngine — Hook único que orquesta todo el pipeline PPG.
 *
 * Engines: FingerContactEngine, PPGSignalExtractor, SignalQualityEngine,
 * BeatDetectionEngine, MotionEngine, MeasurementStateMachine.
 *
 * Usa useRef para todo el estado de alta frecuencia (evita re-renders de React).
 */
import { useRef, useCallback, useEffect, useState } from 'react';
import { FingerContactEngine } from '../modules/FingerContactEngine';
import { PPGSignalExtractor } from '../modules/PPGSignalExtractor';
import { SignalQualityEngine } from '../modules/SignalQualityEngine';
import { BeatDetectionEngine } from '../modules/BeatDetectionEngine';
import { MotionEngine } from '../modules/MotionEngine';
import { MeasurementStateMachine } from '../modules/MeasurementStateMachine';
import { PPG_CONFIG } from '../config/ppgConfig';
import type {
  MeasurementState,
  CameraDiagnostics,
  PPGDebugFrame,
  PPGSessionExport,
  DetectedBeat,
  SignalSourceLabel,
} from '../types/ppg-types';

export interface PPGEngineState {
  measurement: MeasurementState;
  camera: CameraDiagnostics;
  heartbeatSignal: number;
  isPeak: boolean;
  debugFrame: PPGDebugFrame | null;
}

export function usePPGEngine() {
  // Engines (stable refs)
  const fingerEngine = useRef(new FingerContactEngine());
  const signalExtractor = useRef(new PPGSignalExtractor());
  const qualityEngine = useRef(new SignalQualityEngine());
  const beatEngine = useRef(new BeatDetectionEngine());
  const motionEngine = useRef(new MotionEngine());
  const stateMachine = useRef(new MeasurementStateMachine());

  // FPS tracking
  const fpsBuffer = useRef<number[]>([]);
  const lastFrameTs = useRef(0);
  const effectiveFps = useRef(30);
  const fpsJitter = useRef(0);

  // Debug log
  const debugFrames = useRef<PPGDebugFrame[]>([]);
  const allBeats = useRef<DetectedBeat[]>([]);
  const startTime = useRef(0);
  const frameCount = useRef(0);
  const lastLogTime = useRef(0);

  // Published state (low-frequency updates for React)
  const [measurementState, setMeasurementState] = useState<MeasurementState>({
    phase: 'IDLE', contactState: 'SEARCHING_FINGER', qualityLevel: 'UNUSABLE',
    bpm: 0, bpmConfidence: 0, bpmIsStale: false, warmupProgress: 0,
    stableContactMs: 0, elapsedMs: 0, invalidReasons: [],
    instruction: 'Presiona INICIAR', semaphore: 'red',
  });

  // High-frequency refs for rendering
  const heartbeatSignalRef = useRef(0);
  const isPeakRef = useRef(false);
  const bpmRef = useRef(0);
  const bpmConfidenceRef = useRef(0);
  const qualityScoreRef = useRef(0);
  const contactInstructionRef = useRef('');
  const semaphoreRef = useRef<'red' | 'yellow' | 'green'>('red');
  const warmupProgressRef = useRef(0);
  const stableContactMsRef = useRef(0);
  const activeSourceRef = useRef<SignalSourceLabel>('GREEN');
  const motionScoreRef = useRef(0);
  const perfusionRef = useRef(0);
  const clippingRef = useRef(0);
  const invalidReasonsRef = useRef<string[]>([]);

  // React state update throttle
  const lastUIUpdateRef = useRef(0);
  const UI_UPDATE_INTERVAL = 250; // 4 Hz UI updates

  // Processing flag
  const isProcessingRef = useRef(false);

  const startEngine = useCallback(() => {
    fingerEngine.current.reset();
    signalExtractor.current.reset();
    beatEngine.current.reset();
    motionEngine.current.reset();
    stateMachine.current.reset();

    motionEngine.current.start();
    stateMachine.current.start();
    startTime.current = Date.now();
    frameCount.current = 0;
    lastFrameTs.current = 0;
    fpsBuffer.current = [];
    debugFrames.current = [];
    allBeats.current = [];
    isProcessingRef.current = true;

    setMeasurementState(prev => ({
      ...prev, phase: 'PLACING_FINGER', instruction: 'Cubrí completamente cámara y flash',
      semaphore: 'red',
    }));
  }, []);

  const stopEngine = useCallback(() => {
    isProcessingRef.current = false;
    motionEngine.current.stop();
    stateMachine.current.stop();
  }, []);

  /**
   * Process one video frame. Called from requestVideoFrameCallback.
   */
  const processFrame = useCallback((imageData: ImageData) => {
    if (!isProcessingRef.current) return;

    const now = Date.now();
    frameCount.current++;

    // FPS tracking
    if (lastFrameTs.current > 0) {
      const delta = now - lastFrameTs.current;
      if (delta > 5 && delta < 200) {
        fpsBuffer.current.push(delta);
        if (fpsBuffer.current.length > PPG_CONFIG.camera.fpsBufferSize) fpsBuffer.current.shift();
        if (fpsBuffer.current.length >= 10) {
          const sorted = [...fpsBuffer.current].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)] ?? 33;
          effectiveFps.current = Math.max(10, Math.min(60, 1000 / median));
          // Jitter
          const mean = fpsBuffer.current.reduce((a, b) => a + b, 0) / fpsBuffer.current.length;
          const variance = fpsBuffer.current.reduce((a, d) => a + (d - mean) ** 2, 0) / fpsBuffer.current.length;
          fpsJitter.current = Math.sqrt(variance);
          // Update sample rate
          signalExtractor.current.setSampleRate(effectiveFps.current);
        }
      }
    }
    lastFrameTs.current = now;

    // 1. Extract frame RGB data
    const frameData = signalExtractor.current.extractFrameData(imageData);

    // 2. Motion update
    motionEngine.current.updateVisual(frameData.brightness);
    const motionResult = motionEngine.current.getResult();
    const motionScore = motionResult.score;

    // 3. Finger contact
    fingerEngine.current.setPerfusion(signalExtractor.current.greenAC, signalExtractor.current.greenDC);
    const contactResult = fingerEngine.current.process(frameData, motionScore);

    // 4. Signal extraction (only if finger detected)
    let filtered = 0;
    let perfusion = 0;
    let clipping = 0;
    let flatline = false;

    if (contactResult.fingerDetected) {
      const extraction = signalExtractor.current.extract(frameData, motionScore > PPG_CONFIG.motion.threshold);
      filtered = extraction.filtered;
      perfusion = extraction.perfusionIndex;
      clipping = extraction.clippingRate;
      flatline = extraction.flatline;
    }

    // 5. Quality evaluation
    const filteredBuf = signalExtractor.current.getFilteredBuffer();
    const warmupComplete = contactResult.warmupProgress >= 1.0;
    const rrIntervals = beatEngine.current.getRRIntervals();
    const consecutiveBeats = 0; // Will be updated after beat detection

    const qualityResult = qualityEngine.current.evaluate(
      filteredBuf, rrIntervals, beatEngine.current.getRRIntervals().length,
      motionScore, perfusion, clipping, effectiveFps.current, warmupComplete,
    );

    // 6. Beat detection (only with sufficient contact and quality)
    let beatResult = { isPeak: false, beat: undefined as DetectedBeat | undefined, bpm: 0, bpmConfidence: 0, rrIntervals: [] as number[], consecutiveValidBeats: 0 };

    if (contactResult.fingerDetected && qualityResult.level !== 'UNUSABLE') {
      beatResult = beatEngine.current.process(filtered, now, qualityResult.score, motionScore);

      if (beatResult.beat) {
        allBeats.current.push(beatResult.beat);
        if (allBeats.current.length > 1000) allBeats.current.shift();
      }
    }

    // 7. State machine update
    const msState = stateMachine.current.update(
      contactResult.state,
      qualityResult.level,
      qualityResult.score,
      beatResult.bpm,
      beatResult.bpmConfidence,
      beatEngine.current.isBPMStale(),
      beatResult.consecutiveValidBeats,
      qualityResult.invalidReasons,
      contactResult.warmupProgress,
    );

    // Update high-frequency refs
    heartbeatSignalRef.current = filtered;
    isPeakRef.current = beatResult.isPeak;
    bpmRef.current = msState.bpm;
    bpmConfidenceRef.current = msState.bpmConfidence;
    qualityScoreRef.current = qualityResult.score;
    contactInstructionRef.current = contactResult.instruction;
    semaphoreRef.current = msState.semaphore;
    warmupProgressRef.current = contactResult.warmupProgress;
    stableContactMsRef.current = msState.stableContactMs;
    activeSourceRef.current = signalExtractor.current.getActiveSource();
    motionScoreRef.current = motionScore;
    perfusionRef.current = perfusion;
    clippingRef.current = clipping;
    invalidReasonsRef.current = qualityResult.invalidReasons;

    // Debug frame
    if (debugFrames.current.length < PPG_CONFIG.debug.maxExportRows) {
      debugFrames.current.push({
        timestamp: now,
        rawR: frameData.meanR,
        rawG: frameData.meanG,
        rawB: frameData.meanB,
        rawBrightness: frameData.brightness,
        selectedSignal: filtered,
        signalSource: signalExtractor.current.getActiveSource(),
        filteredSignal: filtered,
        contactScore: contactResult.score.total,
        contactState: contactResult.state,
        qualityScore: qualityResult.score,
        qualityLevel: qualityResult.level,
        motionScore,
        perfusionIndex: perfusion,
        clippingScore: clipping,
        isPeak: beatResult.isPeak,
        bpm: msState.bpm,
        bpmConfidence: msState.bpmConfidence,
        detectorAgreement: beatResult.beat?.detectorAgreementScore ?? 0,
        invalidReasons: qualityResult.invalidReasons.join(';'),
        fps: effectiveFps.current,
        torchActive: true, // Assume active when monitoring
      });
    }

    // Periodic log
    if (now - lastLogTime.current > PPG_CONFIG.debug.logIntervalMs) {
      lastLogTime.current = now;
      console.log(
        `📊 PPG [${signalExtractor.current.getActiveSource()}] ` +
        `BPM=${msState.bpm} Q=${qualityResult.score.toFixed(0)}/${qualityResult.level} ` +
        `Contact=${contactResult.state} PI=${perfusion.toFixed(2)} ` +
        `Motion=${motionScore.toFixed(2)} FPS=${effectiveFps.current.toFixed(0)} ` +
        `Phase=${msState.phase} Beats=${beatResult.consecutiveValidBeats}`
      );
    }

    // Throttled React state update
    if (now - lastUIUpdateRef.current > UI_UPDATE_INTERVAL) {
      lastUIUpdateRef.current = now;
      const updatedState: MeasurementState = {
        ...msState,
        contactState: contactResult.state,
        qualityLevel: qualityResult.level,
        instruction: msState.phase === 'READING_RELIABLE'
          ? 'Lectura confiable'
          : msState.phase === 'READING_INVALID'
            ? msState.instruction
            : contactResult.instruction,
      };
      setMeasurementState(updatedState);
    }
  }, []);

  /**
   * Export session data as JSON
   */
  const exportSession = useCallback((): PPGSessionExport => {
    const frames = debugFrames.current;
    const beats = allBeats.current;
    const duration = frames.length > 0 ? frames[frames.length - 1].timestamp - frames[0].timestamp : 0;

    return {
      deviceInfo: {
        userAgent: navigator.userAgent,
        screenWidth: screen.width,
        screenHeight: screen.height,
        timestamp: new Date().toISOString(),
      },
      config: { ...PPG_CONFIG },
      frames,
      beats,
      summary: {
        totalFrames: frames.length,
        totalBeats: beats.length,
        avgBPM: beats.length > 0 ? Math.round(
          beats.filter(b => b.rrInterval).reduce((s, b) => s + 60000 / (b.rrInterval || 1000), 0) / beats.filter(b => b.rrInterval).length
        ) : 0,
        avgQuality: frames.length > 0
          ? Math.round(frames.reduce((s, f) => s + f.qualityScore, 0) / frames.length)
          : 0,
        avgPerfusion: frames.length > 0
          ? +(frames.reduce((s, f) => s + f.perfusionIndex, 0) / frames.length).toFixed(3)
          : 0,
        durationMs: duration,
      },
    };
  }, []);

  /**
   * Export as CSV string
   */
  const exportCSV = useCallback((): string => {
    const session = exportSession();
    if (session.frames.length === 0) return '';
    const headers = Object.keys(session.frames[0]);
    const lines = [headers.join(PPG_CONFIG.debug.csvDelimiter)];
    for (const frame of session.frames) {
      lines.push(headers.map(h => (frame as any)[h]).join(PPG_CONFIG.debug.csvDelimiter));
    }
    return lines.join('\n');
  }, [exportSession]);

  // Cleanup
  useEffect(() => {
    return () => {
      motionEngine.current.stop();
      beatEngine.current.dispose();
    };
  }, []);

  return {
    // Controls
    startEngine,
    stopEngine,
    processFrame,

    // State (React-safe, throttled)
    measurementState,

    // High-frequency refs (for canvas rendering)
    heartbeatSignalRef,
    isPeakRef,
    bpmRef,
    bpmConfidenceRef,
    qualityScoreRef,
    contactInstructionRef,
    semaphoreRef,
    warmupProgressRef,
    stableContactMsRef,
    activeSourceRef,
    motionScoreRef,
    perfusionRef,
    clippingRef,
    invalidReasonsRef,

    // Export
    exportSession,
    exportCSV,

    // Engine access for vital signs integration
    signalExtractor,
    beatEngine,
  };
}
