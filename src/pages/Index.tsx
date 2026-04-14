import React, { useState, useRef, useEffect, useCallback } from "react";
import { Heart, AlertTriangle, Activity, X, Shield, Clock, CheckCircle2, Brain, Loader2 } from "lucide-react";
import { playCompletionSound } from "@/utils/soundUtils";
import VitalSign from "@/components/VitalSign";
import CameraView, { CameraViewHandle } from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { emptyHeartBeatResult } from "@/modules/signal-processing/beatContactGating";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import { useSaveMeasurement } from "@/hooks/useSaveMeasurement";
import { useHealthAnalysis } from "@/hooks/useHealthAnalysis";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import type { BeatFlags } from "@/types/beat";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { NON_ALERT_RHYTHM_LABELS } from "@/constants/rhythmAlert";
import {
  getUserHeightMFromStorage,
  DEFAULT_USER_HEIGHT_M,
  clampUserHeightM,
} from "@/modules/personalization/userPhysiology";
import { FrameCaptureScheduler } from "@/modules/camera/FrameCaptureScheduler";
import type { CaptureTimingContext } from "@/modules/camera/CaptureMetrology";
import { PPGPipelineDebugOverlay } from "@/components/PPGPipelineDebugOverlay";
import { cn } from "@/lib/utils";

function formatElapsed(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0,
    glucose: 0,
    pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
    arrhythmiaCount: 0,
    arrhythmiaStatus: "SINUS_STABLE|0",
    lipids: { totalCholesterol: 0, triglycerides: 0 },
    isCalibrating: false,
    calibrationProgress: 0,
    lastArrhythmiaData: undefined,
    signalQuality: 0,
    measurementConfidence: 'INVALID'
  });
  const [heartRate, setHeartRate] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Tras el primer intento (éxito o fallo), no volver a tapar la UI — la API fullscreen suele fallar en iOS/Android. */
  const [fullscreenPromptDismissed, setFullscreenPromptDismissed] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  const [measurementSummary, setMeasurementSummary] = useState<{
    totalBeats: number;
    arrhythmiaBeats: number;
    normalPercent: number;
  } | null>(null);

  const measurementTimerRef = useRef<number | null>(null);
  const totalBeatsRef = useRef(0);
  const arrhythmiaBeatsRef = useRef(0);
  const lastArrhythmiaCountForBeatsRef = useRef(0);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaToastRef = useRef<{ t: number; label: string }>({ t: 0, label: '' });
  const arrhythmiaToastPendingRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  /** Secuencia monótona por latido aceptado → `PPGSignalMeter` (marcadores morfológicos). */
  const peakSeqRef = useRef(0);
  const [peakEvent, setPeakEvent] = useState<{
    seq: number;
    flags: BeatFlags | null;
    wallTime: number;
    morphologyScore?: number | null;
  }>({ seq: 0, flags: null, wallTime: 0, morphologyScore: null });
  const cameraRef = useRef<CameraViewHandle>(null);
  const autoFinalizeAt60Ref = useRef(false);
  const captureSchedulerRef = useRef<FrameCaptureScheduler | null>(null);
  const captureBusyRef = useRef(false);
  const frameLoopRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const EMA_ALPHA = 0.22;
  const emaRef = useRef({
    bpm: 0, spo2: 0, systolic: 0, diastolic: 0,
    glucose: 0, cholesterol: 0, triglycerides: 0,
  });

  const applyEMA = useCallback((prev: number, next: number): number => {
    if (next === 0) return 0;
    if (prev === 0) return next;
    return Math.round(prev * (1 - EMA_ALPHA) + next * EMA_ALPHA);
  }, []);

  const computeRRStability = useCallback((intervals: number[]): number => {
    if (!intervals || intervals.length < 3) return 0;
    const recent = intervals.slice(-8);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, rr) => sum + (rr - mean) ** 2, 0) / recent.length;
    const cv = Math.sqrt(variance) / Math.max(1, mean);
    return Math.max(0, Math.min(1, 1 - cv * 2));
  }, []);

  const {
    startProcessing,
    stopProcessing,
    lastSignal,
    getLastSignal,
    getLastBeatResult,
    getBeatMeasurementActive,
    processFrame,
    isProcessing,
    framesProcessed,
    getRGBStats,
    getPositionQuality,
    resetProcessingEngine,
    setCameraControl,
    setPPGDebugMode,
  } = useSignalProcessor();

  const ppgDebug =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('ppgDebug');

  const processFrameRef = useRef(processFrame);
  processFrameRef.current = processFrame;
  
  const { 
    processSignal: processVitalSigns, 
    setRGBData,
    setUpstreamContext,
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    hasValidPressureEstimate,
    lastValidResults,
    startCalibration,
    forceCalibrationCompletion,
    getCalibrationProgress,
    setHeartRuntime,
    ingestBeatOpticalRatio,
    setUserHeightM,
  } = useVitalSignsProcessor();
  
  const { saveMeasurement } = useSaveMeasurement();
  const { analysis, isAnalyzing, analyzeVitals, clearAnalysis } = useHealthAnalysis();
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);

  const vitalSignsRef = useRef(vitalSigns);
  vitalSignsRef.current = vitalSigns;

  const enterFullScreen = async () => {
    try {
      if (isFullscreen) {
        setFullscreenPromptDismissed(true);
        return;
      }
      try {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if ((docEl as any).webkitRequestFullscreen) {
          await (docEl as any).webkitRequestFullscreen();
        }
        if (screen.orientation?.lock) {
          await screen.orientation.lock('portrait').catch(() => {});
        }
        setIsFullscreen(true);
      } catch (err) {
        console.log('Error pantalla completa:', err);
        setIsFullscreen(true);
      }
    } finally {
      setFullscreenPromptDismissed(true);
    }
  };
  
  const exitFullScreen = () => {
    if (!isFullscreen) return;
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
      screen.orientation?.unlock();
      setIsFullscreen(false);
    } catch {}
  };

  useEffect(() => {
    const timer = setTimeout(() => enterFullScreen(), 1000);
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const h = getUserHeightMFromStorage() ?? DEFAULT_USER_HEIGHT_M;
    setUserHeightM(clampUserHeightM(h));
  }, [setUserHeightM]);

  useEffect(() => {
    const preventScroll = (e: Event) => e.preventDefault();
    document.body.addEventListener('touchmove', preventScroll, { passive: false });
    document.body.addEventListener('scroll', preventScroll, { passive: false });
    return () => {
      document.body.removeEventListener('touchmove', preventScroll);
      document.body.removeEventListener('scroll', preventScroll);
    };
  }, []);

  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
  }, [lastValidResults, isMonitoring]);

  const startFrameLoop = useCallback(() => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    if (!captureSchedulerRef.current) {
      captureSchedulerRef.current = new FrameCaptureScheduler({
        targetWidth: 320,
        targetHeight: 240,
        preferBitmapPath: true,
      });
    } else {
      captureSchedulerRef.current.resetMetrology();
    }

    const captureOneFrame = (presentationTime?: number) => {
      if (!isProcessingRef.current) return;
      const video = cameraRef.current?.getVideoElement();
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        frameLoopRef.current = requestAnimationFrame(() => captureOneFrame(performance.now()));
        return;
      }

      const frameTimestamp =
        typeof presentationTime === 'number' && isFinite(presentationTime) ? presentationTime : performance.now();
      const sched = captureSchedulerRef.current!;
      sched.recordPresentationTimestamp(frameTimestamp);
      const timingSnap: CaptureTimingContext = sched.getTimingSnapshot();

      if (captureBusyRef.current) {
        scheduleNext(video);
        return;
      }

      captureBusyRef.current = true;
      void (async () => {
        try {
          const frame = await sched.captureFromVideo(video);
          if (frame && isProcessingRef.current) {
            processFrameRef.current(frame, frameTimestamp, { captureTiming: timingSnap });
          }
        } catch {
          /* noop */
        } finally {
          captureBusyRef.current = false;
        }
        scheduleNext(video);
      })();
    };

    const scheduleNext = (video: HTMLVideoElement) => {
      if (!isProcessingRef.current) return;
      if ('requestVideoFrameCallback' in video) {
        const v = video as HTMLVideoElement & {
          requestVideoFrameCallback: (
            cb: (now: number, metadata?: VideoFrameCallbackMetadata) => void
          ) => number;
        };
        v.requestVideoFrameCallback((now, metadata) => {
          const tPresent =
            metadata != null &&
            typeof metadata.presentationTime === 'number' &&
            Number.isFinite(metadata.presentationTime)
              ? metadata.presentationTime
              : metadata != null &&
                  typeof metadata.expectedDisplayTime === 'number' &&
                  Number.isFinite(metadata.expectedDisplayTime)
                ? metadata.expectedDisplayTime
                : now;
          captureOneFrame(tPresent);
        });
      } else {
        frameLoopRef.current = requestAnimationFrame(() => captureOneFrame(performance.now()));
      }
    };

    captureOneFrame(performance.now());
  }, []);

  const stopFrameLoop = useCallback(() => {
    isProcessingRef.current = false;
    if (frameLoopRef.current) {
      cancelAnimationFrame(frameLoopRef.current);
      frameLoopRef.current = null;
    }
  }, []);

  const startMonitoring = useCallback(() => {
    if (isMonitoring) return;
    console.log('🚀 Iniciando monitoreo...');
    if (navigator.vibrate) navigator.vibrate([200]);
    enterFullScreen();
    setShowResults(false);
    setMeasurementSummary(null);
    setElapsedTime(0);
    totalBeatsRef.current = 0;
    arrhythmiaBeatsRef.current = 0;
    lastArrhythmiaCountForBeatsRef.current = 0;
    captureSchedulerRef.current?.resetMetrology();
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SINUS_STABLE|0" }));
    peakSeqRef.current = 0;
    setPeakEvent({ seq: 0, flags: null, wallTime: 0, morphologyScore: null });
    startProcessing();
    setIsMonitoring(true);
    if (measurementTimerRef.current) clearInterval(measurementTimerRef.current);
    measurementTimerRef.current = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    setIsCalibrating(true);
    startCalibration();
    setTimeout(() => setIsCalibrating(false), 3000);
  }, [isMonitoring, startProcessing, startCalibration, enterFullScreen]);

  const handleStreamReady = useCallback((_stream: MediaStream) => {
    console.log('📹 Stream recibido');
    try {
      const cc = cameraRef.current?.getCameraControl();
      if (cc) setCameraControl(cc);
    } catch {
      /* noop */
    }
    setPPGDebugMode(ppgDebug);
    setTimeout(() => {
      const video = cameraRef.current?.getVideoElement();
      if (video && video.readyState >= 2) {
        console.log('✅ Video listo:', video.videoWidth, 'x', video.videoHeight);
        startFrameLoop();
      } else {
        const checkReady = setInterval(() => {
          const v = cameraRef.current?.getVideoElement();
          if (v && v.readyState >= 2 && v.videoWidth > 0) {
            clearInterval(checkReady);
            console.log('✅ Video listo (retry):', v.videoWidth, 'x', v.videoHeight);
            startFrameLoop();
          }
        }, 100);
        setTimeout(() => clearInterval(checkReady), 5000);
      }
    }, 500);
  }, [startFrameLoop, setCameraControl, setPPGDebugMode, ppgDebug]);

  const finalizeMeasurement = useCallback(async () => {
    if (!isMonitoring) return;
    console.log('🛑 Finalizando medición...');
    playCompletionSound();
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    stopFrameLoop();
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    stopProcessing();
    if (isCalibrating) forceCalibrationCompletion();
    const savedResults = resetVitalSigns();
    if (savedResults || vitalSigns.spo2 > 0) {
      const dataToSave = savedResults || vitalSigns;
      await saveMeasurement({
        heartRate,
        vitalSigns: dataToSave,
        signalQuality: lastSignal?.quality || 0
      });
    }
    setIsMonitoring(false);
    setIsCalibrating(false);
    captureSchedulerRef.current?.resetMetrology();
    if (savedResults) setVitalSigns(savedResults);
    setShowResults(true);
    const total = totalBeatsRef.current;
    const arrBeats = arrhythmiaBeatsRef.current;
    setMeasurementSummary({
      totalBeats: total,
      arrhythmiaBeats: arrBeats,
      normalPercent: total > 0 ? Math.round(((total - arrBeats) / total) * 100) : 100
    });
    setElapsedTime(0);
    setCalibrationProgress(0);
    console.log('✅ Medición finalizada y guardada');
  }, [isMonitoring, isCalibrating, stopFrameLoop, stopProcessing, forceCalibrationCompletion, resetVitalSigns, saveMeasurement, heartRate, vitalSigns, lastSignal]);

  const handleReset = useCallback(() => {
    console.log('🔄 Reset completo...');
    stopFrameLoop();
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    stopProcessing();
    fullResetVitalSigns();
    resetProcessingEngine();
    emaRef.current = { bpm: 0, spo2: 0, systolic: 0, diastolic: 0, glucose: 0, cholesterol: 0, triglycerides: 0 };
    captureSchedulerRef.current?.resetMetrology();
    setIsMonitoring(false);
    setShowResults(false);
    setMeasurementSummary(null);
    setIsCalibrating(false);
    setElapsedTime(0);
    setHeartRate(0);
    totalBeatsRef.current = 0;
    arrhythmiaBeatsRef.current = 0;
    lastArrhythmiaCountForBeatsRef.current = 0;
    unstableFrameCounter.current = 0;
    setRRIntervals([]);
    setVitalSigns({ 
      spo2: 0,
      glucose: 0,
      pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
      arrhythmiaCount: 0,
      arrhythmiaStatus: "SINUS_STABLE|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false,
      calibrationProgress: 0,
      lastArrhythmiaData: undefined,
      signalQuality: 0,
      measurementConfidence: 'INVALID'
    });
    setArrhythmiaCount("--");
    lastArrhythmiaData.current = null;
    peakSeqRef.current = 0;
    setPeakEvent({ seq: 0, flags: null, wallTime: 0, morphologyScore: null });
    setCalibrationProgress(0);
    arrhythmiaDetectedRef.current = false;
    arrhythmiaToastPendingRef.current = false;
    lastArrhythmiaToastRef.current = { t: 0, label: '' };
    console.log('✅ Reset completado');
  }, [stopFrameLoop, stopProcessing, fullResetVitalSigns, resetProcessingEngine]);

  const vitalSignsFrameCounter = useRef<number>(0);
  const unstableFrameCounter = useRef<number>(0);
  /** Frames consecutivos "malos" antes de borrar FC (histéresis; ~≥0,7 s a ~22 ms/tick). */
  const UNSTABLE_ZERO_THRESHOLD = 32;
  const VITALS_PROCESS_EVERY_N_FRAMES = 3;
  const lastProcessedSignalTsRef = useRef<number | null>(null);
  const signalProcessingTickRef = useRef<() => void>(() => {});

  signalProcessingTickRef.current = () => {
    const lastSignal = getLastSignal();
    if (!lastSignal) return;
    if (lastSignal.timestamp === lastProcessedSignalTsRef.current) return;
    lastProcessedSignalTsRef.current = lastSignal.timestamp;

    const ls = lastSignal as typeof lastSignal & {
      clipHighRatio?: number;
      clipLowRatio?: number;
      pressureState?: 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE';
      estimatedSampleRate?: number;
      sourceStability?: number;
      maskIoU?: number;
      roiCoverage?: number;
      captureTimingConfidence?: number;
      presentationJitterMs?: number;
    };
    const positionQuality = getPositionQuality();
    const stableHumanSignal = getBeatMeasurementActive();

    const clipHigh = ls.clipHighRatio ?? 0;
    const clipLow = ls.clipLowRatio ?? 0;
    const ppgPressure = ls.pressureState;
    const pressureOptimal =
      ppgPressure === 'OPTIMAL_PRESSURE' ||
      (positionQuality.locked && !positionQuality.drifting && positionQuality.qualityScore >= 0.55);
    const sourceStability = Math.max(
      0,
      Math.min(1, (ls.sourceStability ?? positionQuality.qualityScore) || 0)
    );

    const heartBeatResult =
      getLastBeatResult() ?? emptyHeartBeatResult(0);

    if (!stableHumanSignal) {
      unstableFrameCounter.current++;
      if (unstableFrameCounter.current < UNSTABLE_ZERO_THRESHOLD) {
        return;
      }
      setHeartRate(0);
      emaRef.current.bpm = 0;
      vitalSignsFrameCounter.current = 0;
      setRRIntervals([]);
      setArrhythmiaCount("--");
      if (arrhythmiaDetectedRef.current) {
        arrhythmiaDetectedRef.current = false;
      }
      setVitalSigns(prev => (
        prev.measurementConfidence === 'INVALID' && prev.spo2 === 0 && prev.glucose === 0 && prev.pressure.systolic === 0 && prev.pressure.diastolic === 0
          ? prev
          : {
              ...prev,
              spo2: 0,
              glucose: 0,
              pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
              arrhythmiaCount: 0,
              arrhythmiaStatus: "SINUS_STABLE|0",
              lipids: { totalCholesterol: 0, triglycerides: 0 },
              lastArrhythmiaData: undefined,
              signalQuality: 0,
              measurementConfidence: 'INVALID'
              }
      ));
      return;
    }

    unstableFrameCounter.current = 0;
    const smoothedBPM = applyEMA(emaRef.current.bpm, heartBeatResult.bpm);
    emaRef.current.bpm = smoothedBPM;
    setHeartRate(smoothedBPM);

    if (heartBeatResult.isPeak) {
      ingestBeatOpticalRatio();
      totalBeatsRef.current++;
      peakSeqRef.current += 1;
      setPeakEvent({
        seq: peakSeqRef.current,
        flags: heartBeatResult.beatFlags,
        wallTime: performance.now(),
        morphologyScore: heartBeatResult.debug.morphologyScore ?? null,
      });
      const currentArrCount = vitalSignsRef.current.arrhythmiaCount || 0;
      if (currentArrCount > lastArrhythmiaCountForBeatsRef.current) {
        arrhythmiaBeatsRef.current++;
        lastArrhythmiaCountForBeatsRef.current = currentArrCount;
      }
    }

    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }

    vitalSignsFrameCounter.current++;

    if (vitalSignsFrameCounter.current >= VITALS_PROCESS_EVERY_N_FRAMES) {
      vitalSignsFrameCounter.current = 0;
      const rgbStats = getRGBStats();
      const detectorAgreement = heartBeatResult.detectorAgreement || heartBeatResult.debug.detectorAgreement || 0;
      const rrStability = computeRRStability(heartBeatResult.rrData?.intervals || []);
      const beatInputs = heartBeatResult.debug.recentAcceptedBeats && heartBeatResult.debug.recentAcceptedBeats.length > 0
        ? heartBeatResult.debug.recentAcceptedBeats.slice(-12).map((beat) => ({
            ibiMs: beat.ibiMs,
            beatSQI: beat.beatSQI,
            morphologyScore: beat.morphologyScore,
            detectorAgreement: beat.detectorAgreement,
            amplitude: beat.amplitude,
            flags: {
              isWeak: beat.flags.isWeak,
              isPremature: beat.flags.isPremature,
              isSuspicious: beat.flags.isSuspicious,
              isDoublePeak: beat.flags.isDoublePeak,
            }
          }))
        : undefined;

      const pipelineContactQuality = Math.min(
        100,
        Math.round(
          (lastSignal.quality ?? 0) * 0.88 +
            (lastSignal.maskIoU ?? 0) * 22 +
            (lastSignal.roiCoverage ?? 0) * 28
        )
      );
      setUpstreamContext({
        contactStable: lastSignal.measurementReady === true,
        pressureOptimal,
        clipHighRatio: clipHigh,
        clipLowRatio: ls.clipLowRatio ?? 0,
        sourceStability,
        avgBeatSQI: heartBeatResult.beatSQI || heartBeatResult.debug.lastBeatSQI || 0,
        beatCount: heartBeatResult.debug.beatsAccepted || heartBeatResult.rrData?.intervals.length || 0,
        sampleRate:
          ls.estimatedSampleRate != null && ls.estimatedSampleRate >= 15 && ls.estimatedSampleRate <= 60
            ? ls.estimatedSampleRate
            : undefined,
        detectorAgreement,
        rrStability,
        pipelineContactQuality,
        maskIoU: ls.maskIoU,
        captureTimingConfidence: ls.captureTimingConfidence,
        presentationJitterMs: ls.presentationJitterMs,
      });

      if (rgbStats.redDC > 0 && rgbStats.greenDC > 0) {
        setRGBData({
          redAC: rgbStats.redAC,
          redDC: rgbStats.redDC,
          greenAC: rgbStats.greenAC,
          greenDC: rgbStats.greenDC
        });
      }

      const usableRRData = heartBeatResult.rrData && heartBeatResult.rrData.intervals.length >= 2 && heartBeatResult.bpmConfidence > 0.18
        ? heartBeatResult.rrData
        : undefined;

      setHeartRuntime({
        bpm: heartBeatResult.bpm,
        bpmConfidence: heartBeatResult.bpmConfidence,
        beatCount: heartBeatResult.debug.beatsAccepted,
      });

      if (lastSignal.measurementReady === true) {
        const vitals = processVitalSigns(
          lastSignal.filteredValue,
          usableRRData,
          beatInputs,
          lastSignal.timestamp
        );

        const e = emaRef.current;
        const smoothed: typeof vitals = {
          ...vitals,
          spo2: applyEMA(e.spo2, vitals.spo2),
          glucose: applyEMA(e.glucose, vitals.glucose),
          pressure: {
            ...vitals.pressure,
            systolic: applyEMA(e.systolic, vitals.pressure.systolic),
            diastolic: applyEMA(e.diastolic, vitals.pressure.diastolic),
          },
          lipids: {
            totalCholesterol: applyEMA(e.cholesterol, vitals.lipids.totalCholesterol),
            triglycerides: applyEMA(e.triglycerides, vitals.lipids.triglycerides),
          },
        };
        e.spo2 = smoothed.spo2;
        e.glucose = smoothed.glucose;
        e.systolic = smoothed.pressure.systolic;
        e.diastolic = smoothed.pressure.diastolic;
        e.cholesterol = smoothed.lipids.totalCholesterol;
        e.triglycerides = smoothed.lipids.triglycerides;

        setVitalSigns(smoothed);

        if (usableRRData && vitals.measurementConfidence !== 'INVALID') {
          const arrhythmiaStatus = vitals.arrhythmiaStatus;
          if (arrhythmiaStatus) {
            lastArrhythmiaData.current = vitals.lastArrhythmiaData || null;
            const parts = arrhythmiaStatus.split('|');
            const rhythmLabel = vitals.rhythm?.label || parts[0] || 'SINUS_STABLE';
            const count = parseInt(parts[1] || '0', 10) || 0;
            setArrhythmiaCount(count > 0 ? count : rhythmLabel.split('_').join(' '));

            const isArrhythmiaDetected = !NON_ALERT_RHYTHM_LABELS.has(rhythmLabel);
            if (isArrhythmiaDetected !== arrhythmiaDetectedRef.current) {
              arrhythmiaDetectedRef.current = isArrhythmiaDetected;

              if (isArrhythmiaDetected) {
                const minEvents = 2;
                const cooldownMs = 12000;
                const now = Date.now();
                const sameLabel = lastArrhythmiaToastRef.current.label === rhythmLabel;
                const cooled = now - lastArrhythmiaToastRef.current.t >= cooldownMs;
                const enoughEvents = count >= minEvents;
                if (enoughEvents && (!sameLabel || cooled)) {
                  lastArrhythmiaToastRef.current = { t: now, label: rhythmLabel };
                  arrhythmiaToastPendingRef.current = false;
                  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                  toast({
                    title: `⚠️ ${rhythmLabel.split('_').join(' ')}`,
                    description: count > 0 ? `Eventos detectados: ${count}` : 'Ritmo irregular detectado',
                    variant: "destructive",
                    duration: 4000
                  });
                } else if (!enoughEvents) {
                  arrhythmiaToastPendingRef.current = true;
                }
              } else {
                lastArrhythmiaToastRef.current = { t: 0, label: '' };
                arrhythmiaToastPendingRef.current = false;
              }
            }

            if (
              arrhythmiaToastPendingRef.current &&
              isArrhythmiaDetected &&
              arrhythmiaDetectedRef.current &&
              count >= 2
            ) {
              const now = Date.now();
              const sameLabel = lastArrhythmiaToastRef.current.label === rhythmLabel;
              const cooled = now - lastArrhythmiaToastRef.current.t >= 12000;
              if (!sameLabel || cooled || lastArrhythmiaToastRef.current.t === 0) {
                lastArrhythmiaToastRef.current = { t: now, label: rhythmLabel };
                arrhythmiaToastPendingRef.current = false;
                if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                toast({
                  title: `⚠️ ${rhythmLabel.split('_').join(' ')}`,
                  description: count > 0 ? `Eventos detectados: ${count}` : 'Ritmo irregular detectado',
                  variant: "destructive",
                  duration: 4000
                });
              }
            }
          }
        }
      }
    }
  };

  useEffect(() => {
    if (!isMonitoring) {
      lastProcessedSignalTsRef.current = null;
      return;
    }
    let rafId = 0;
    let lastUiTick = 0;
    const loop = (t: number) => {
      if (t - lastUiTick >= 22) {
        lastUiTick = t;
        signalProcessingTickRef.current();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isMonitoring]);

  useEffect(() => {
    if (!isMonitoring) {
      autoFinalizeAt60Ref.current = false;
      return;
    }
    if (elapsedTime >= 60 && !autoFinalizeAt60Ref.current) {
      autoFinalizeAt60Ref.current = true;
      void finalizeMeasurement();
    }
  }, [elapsedTime, isMonitoring, finalizeMeasurement]);

  useEffect(() => {
    if (!isCalibrating) return;
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);
      if (currentProgress >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
        if (navigator.vibrate) navigator.vibrate([100]);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  const handleToggleMonitoring = () => {
    if (isMonitoring) finalizeMeasurement();
    else startMonitoring();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black" style={{ 
      height: '100svh',
      width: '100vw',
      maxWidth: '100vw',
      maxHeight: '100svh',
      overflow: 'hidden',
      touchAction: 'none',
      userSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none'
    }}>
      {!isFullscreen && !fullscreenPromptDismissed && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto mb-3 flex max-w-lg flex-col gap-2 rounded-2xl border border-cyan-500/35 bg-slate-950/92 px-4 py-3 shadow-[0_-8px_40px_rgba(0,0,0,0.55)] backdrop-blur-md sm:flex-row sm:items-center">
            <p className="text-center text-xs leading-snug text-cyan-50/95 sm:text-left sm:text-sm">
              Pantalla completa mejora la medición. Si no está disponible en tu navegador, puedes continuar igual.
            </p>
            <div className="flex shrink-0 items-center justify-center gap-2 sm:ml-2">
              <button
                type="button"
                onClick={() => void enterFullScreen()}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-cyan-500"
              >
                Pantalla completa
              </button>
              <button
                type="button"
                onClick={() => setFullscreenPromptDismissed(true)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-400 underline decoration-slate-500 hover:text-slate-200"
              >
                Omitir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cámara: solo captura; siempre por debajo del monitor PPG */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <CameraView ref={cameraRef} onStreamReady={handleStreamReady} isMonitoring={isMonitoring} />
      </div>

      {ppgDebug && isMonitoring && (
        <PPGPipelineDebugOverlay
          signal={lastSignal}
          positionQuality={getPositionQuality()}
          captureMetrics={captureSchedulerRef.current?.getMetrics() ?? null}
          cameraDiag={cameraRef.current?.getDiagnostics() ?? null}
          framesProcessed={framesProcessed}
        />
      )}

      <div className="font-display">
        <PPGSignalMeter
          value={lastSignal?.filteredValue ?? 0}
          quality={lastSignal?.quality ?? 0}
          isFingerDetected={Boolean(
            lastSignal?.measurementReady &&
              lastSignal.contactState === 'STABLE_CONTACT' &&
              lastSignal.extendedContactState === 'STABLE_CONTACT'
          )}
          onStartMeasurement={handleToggleMonitoring}
          onReset={handleReset}
          isMonitoring={isMonitoring}
          diagnosticMessage={lastSignal?.diagnostics?.message}
          arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
          rawArrhythmiaData={vitalSigns.lastArrhythmiaData ?? null}
          peakEvent={peakEvent}
          bpm={heartRate}
          spo2={vitalSigns.spo2 > 0 ? vitalSigns.spo2 : 0}
          rrIntervals={rrIntervals}
        />
      </div>

      {/* Flotante: tiempo y calibración (no duplica el encabezado del monitor) */}
      {isMonitoring && (
        <div
          className="pointer-events-none fixed right-3 top-[max(0.5rem,env(safe-area-inset-top))] z-30 flex max-w-[min(100vw-1.5rem,14rem)] flex-col items-end gap-1 text-right"
          aria-hidden
        >
          <div className="rounded-lg border border-cyan-500/35 bg-[#020617]/85 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-cyan-100 shadow-lg backdrop-blur-md sm:text-xs">
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
              {formatElapsed(elapsedTime)}
              <span className="text-slate-500">/ 60:00</span>
            </span>
          </div>
          {isCalibrating && (
            <div className="rounded-md border border-amber-500/35 bg-amber-950/80 px-2 py-1 text-[10px] font-semibold text-amber-100 backdrop-blur-sm">
              Calibrando… {Math.round(calibrationProgress)}%
            </div>
          )}
        </div>
      )}

      {/* Guía de contacto: banda compacta, no cubre el gráfico principal */}
      {isMonitoring &&
        (() => {
          const pq = getPositionQuality();
          const isDrifting = pq.drifting;
          const isLocked = pq.locked && !isDrifting;
          const showGuidance = !isLocked || isDrifting;
          return showGuidance || isLocked ? (
            <div
              className="pointer-events-none fixed left-2 right-2 z-[25] flex justify-center px-1"
              style={{ top: "max(6.25rem, min(18vh, 160px))" }}
            >
              <div
                className={`max-w-[min(100%,26rem)] rounded-xl border px-3 py-2 text-center text-xs font-semibold leading-snug shadow-lg backdrop-blur-md sm:text-sm ${
                  isLocked
                    ? "border-teal-400/40 bg-teal-950/88 text-teal-50 ring-1 ring-teal-500/20"
                    : isDrifting
                      ? "animate-pulse border-rose-500/45 bg-rose-950/88 text-rose-50 ring-1 ring-rose-400/20"
                      : pq.qualityScore > 0.4
                        ? "border-amber-500/45 bg-amber-950/88 text-amber-50 ring-1 ring-amber-400/15"
                        : "border-orange-500/40 bg-orange-950/88 text-orange-50 ring-1 ring-orange-400/15"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  {isLocked ? (
                    <Shield className="h-4 w-4 flex-shrink-0" />
                  ) : isDrifting ? (
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <Activity className="h-4 w-4 flex-shrink-0 animate-pulse" />
                  )}
                  <span className="text-balance">{pq.guidance}</span>
                </span>
              </div>
            </div>
          ) : null;
        })()}

      {/* Displays vitales: franja compacta sobre el dock, sin tapar el lienzo del monitor */}
      {isMonitoring && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[5.1rem] z-20 px-1.5 sm:bottom-[5.25rem] sm:px-3">
          <div className="clinical-vitals-shell clinical-vitals-inner mx-auto max-w-5xl rounded-xl border border-cyan-500/25 bg-slate-950/55 px-1.5 py-2 shadow-[0_-4px_24px_rgba(0,0,0,0.35)] backdrop-blur-md sm:px-3 sm:py-2.5">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2">
              <VitalSign
                label="FREC. CARD."
                value={heartRate > 0 ? Math.round(heartRate) : "--"}
                unit="BPM"
                highlighted={showResults}
              />
              <VitalSign label="SPO2" value={vitalSigns.spo2 > 0 ? vitalSigns.spo2 : "--"} unit="%" highlighted={showResults} />
              <VitalSign
                label="P. ARTERIAL"
                value={
                  vitalSigns.pressure && vitalSigns.pressure.systolic > 0
                    ? `${vitalSigns.pressure.systolic}/${vitalSigns.pressure.diastolic}`
                    : "--/--"
                }
                unit="mmHg"
                highlighted={showResults}
                confidenceLevel={vitalSigns.pressure?.confidence}
                featureQuality={vitalSigns.pressure?.featureQuality}
              />
              <VitalSign label="GLUC. (EST.)" value={vitalSigns.glucose > 0 ? vitalSigns.glucose : "--"} unit="mg/dL" highlighted={showResults} />
              <VitalSign
                label="COL./TRIG. (EST.)"
                value={
                  vitalSigns.lipids?.totalCholesterol > 0 || vitalSigns.lipids?.triglycerides > 0
                    ? `${vitalSigns.lipids?.totalCholesterol || "--"}/${vitalSigns.lipids?.triglycerides || "--"}`
                    : "--/--"
                }
                unit="mg/dL"
                highlighted={showResults}
              />
              <VitalSign label="ARRITMIAS" value={vitalSigns.arrhythmiaStatus || "SIN ARRITMIAS|0"} highlighted={showResults} />
            </div>
          </div>
        </div>
      )}

      {showResults && measurementSummary && (() => {
        const { totalBeats, arrhythmiaBeats, normalPercent } = measurementSummary;
        const normalBeats = totalBeats - arrhythmiaBeats;
        const avgBpm = heartRate > 0 ? Math.round(heartRate) : '--';
        const statusColor = normalPercent >= 95 ? 'emerald' : normalPercent >= 80 ? 'yellow' : 'red';
        const statusText = vitalSigns.rhythm?.label ? vitalSigns.rhythm.label.split('_').join(' ') : (normalPercent >= 95 ? 'RITMO NORMAL' : normalPercent >= 80 ? 'LEVE IRREGULARIDAD' : 'IRREGULARIDAD DETECTADA');
        const statusIcon = normalPercent >= 95 ? CheckCircle2 : AlertTriangle;
        const StatusIcon = statusIcon;

        return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md animate-fade-in">
                <div className="font-display max-w-sm w-[92%] overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-950 shadow-[0_24px_80px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(34,211,238,0.08)]">
                  <div
                    className={cn(
                      "border-b border-slate-800 px-4 py-3",
                      statusColor === "emerald" && "bg-emerald-500/10",
                      statusColor === "yellow" && "bg-yellow-500/10",
                      statusColor === "red" && "bg-red-500/10"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusIcon
                          className={cn(
                            "h-5 w-5",
                            statusColor === "emerald" && "text-emerald-400",
                            statusColor === "yellow" && "text-yellow-400",
                            statusColor === "red" && "text-red-400"
                          )}
                        />
                        <div>
                          <h3 className="text-sm font-bold tracking-wide text-white">MEDICIÓN COMPLETADA</h3>
                          <p
                            className={cn(
                              "text-[10px] font-semibold tracking-wider",
                              statusColor === "emerald" && "text-emerald-400",
                              statusColor === "yellow" && "text-yellow-400",
                              statusColor === "red" && "text-red-400"
                            )}
                          >
                            {statusText}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => setMeasurementSummary(null)} className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors">
                        <X className="w-4 h-4 text-slate-400" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-900/80 rounded-xl p-3 text-center border border-slate-800/50">
                        <Heart className="w-4 h-4 text-red-400 mx-auto mb-1" fill="currentColor" />
                        <div className="text-white text-2xl font-bold leading-none">{avgBpm}</div>
                        <div className="text-slate-500 text-[9px] mt-1 font-medium">BPM PROMEDIO</div>
                      </div>
                      <div className="bg-slate-900/80 rounded-xl p-3 text-center border border-slate-800/50">
                        <Activity className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
                        <div className="text-white text-2xl font-bold leading-none">
                          {vitalSigns.spo2 > 0 ? vitalSigns.spo2 : '--'}
                          <span className="text-sm text-slate-400">%</span>
                        </div>
                        <div className="text-slate-500 text-[9px] mt-1 font-medium">SpO₂</div>
                      </div>
                    </div>

                    {vitalSigns.pressure?.systolic > 0 && (
                      <div className="bg-slate-900/80 rounded-xl p-3 border border-slate-800/50 flex items-center gap-3">
                        <Shield className="w-5 h-5 text-blue-400" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-slate-500 text-[9px] font-medium">PRESIÓN ARTERIAL</div>
                            {vitalSigns.pressure.confidence && vitalSigns.pressure.confidence !== 'INSUFFICIENT' && (
                              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${
                                vitalSigns.pressure.confidence === 'HIGH' ? 'bg-emerald-500/20 text-emerald-400' :
                                vitalSigns.pressure.confidence === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-orange-500/20 text-orange-400'
                              }`}>
                                {vitalSigns.pressure.confidence}
                              </span>
                            )}
                          </div>
                          <div className="text-white text-lg font-bold">
                            {vitalSigns.pressure.systolic}/{vitalSigns.pressure.diastolic}
                            <span className="text-xs text-slate-500 ml-1">mmHg</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-slate-900/80 rounded-xl p-3 border border-slate-800/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-slate-400 text-[10px] font-semibold tracking-wide">ANÁLISIS DE RITMO</span>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span className="text-slate-500 text-[9px]">30s</span>
                        </div>
                      </div>
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-emerald-400 text-[9px] font-medium">■ Normales</span>
                          <span className="text-white text-xs font-bold">{normalBeats}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-1000 ease-out" style={{ width: `${totalBeats > 0 ? (normalBeats / totalBeats) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-red-400 text-[9px] font-medium">■ Arrítmicos</span>
                          <span className="text-white text-xs font-bold">{arrhythmiaBeats}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-1000 ease-out ${arrhythmiaBeats > 0 ? 'bg-gradient-to-r from-red-600 to-red-400' : 'bg-slate-700'}`} style={{ width: `${totalBeats > 0 ? (arrhythmiaBeats / totalBeats) * 100 : 100}%` }} />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-4 pt-1">
                      <div className="relative w-16 h-16">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#1e293b" strokeWidth="3" />
                          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" className={`${statusColor === 'emerald' ? 'stroke-emerald-400' : statusColor === 'yellow' ? 'stroke-yellow-400' : 'stroke-red-400'}`} strokeWidth="3" strokeDasharray={`${normalPercent}, 100`} strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={`text-sm font-bold ${statusColor === 'emerald' ? 'text-emerald-400' : statusColor === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>{normalPercent}%</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-white text-xs font-semibold">Ritmo Normal</div>
                        <div className="text-slate-500 text-[9px]">{totalBeats} latidos analizados</div>
                        <div className={`text-[10px] font-semibold mt-0.5 ${statusColor === 'emerald' ? 'text-emerald-400' : statusColor === 'yellow' ? 'text-yellow-400' : 'text-red-400'}`}>{statusText}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        analyzeVitals({ heartRate, vitalSigns, quality: lastSignal?.quality || 0 });
                        setShowAIAnalysis(true);
                      }}
                      disabled={isAnalyzing}
                      className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-sm transition-all disabled:opacity-50"
                    >
                      {isAnalyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analizando...</> : <><Brain className="w-4 h-4" /> Análisis AI de Salud</>}
                    </button>
                  </div>
                </div>
              </div>
        );
      })()}

      {showAIAnalysis && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-950 border border-slate-700/50 rounded-2xl max-w-sm w-[92%] max-h-[80vh] shadow-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-purple-500/10 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-400" />
                <h3 className="text-white text-sm font-bold">Análisis AI de Salud</h3>
              </div>
              <button onClick={() => { setShowAIAnalysis(false); clearAnalysis(); }} className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                  <p className="text-slate-400 text-sm">Analizando tus signos vitales...</p>
                </div>
              ) : analysis ? (
                <div className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{analysis}</div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <p className="text-slate-500 text-sm">No se pudo generar el análisis.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
