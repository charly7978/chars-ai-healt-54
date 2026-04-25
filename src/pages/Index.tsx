import React, { useState, useRef, useEffect, useCallback } from "react";
import { Heart, AlertTriangle, Activity, X, Shield, Clock, CheckCircle2, Brain, Loader2 } from "lucide-react";
import { playCompletionSound } from "@/utils/soundUtils";
import VitalSign from "@/components/VitalSign";
import CameraView, { CameraViewHandle } from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { VideoFrameScheduler } from "@/modules/signal-processing/VideoFrameScheduler";
import { ExtractionResolutionController } from "@/modules/signal-processing/ExtractionResolutionController";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import { useSaveMeasurement } from "@/hooks/useSaveMeasurement";
import { useHealthAnalysis } from "@/hooks/useHealthAnalysis";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ProcessedSignal } from "@/types/signal";

const NON_ALERT_RHYTHMS = new Set([
  'SIN ARRITMIAS',
  'SINUS_STABLE',
  'SINUS_VARIABLE',
  'CALIBRANDO...',
  'CALIBRANDO',
  'UNDETERMINED_LOW_QUALITY',
  'INSUFFICIENT_DATA',
]);

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
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
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [beatMarker, setBeatMarker] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
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
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const cameraRef = useRef<CameraViewHandle>(null);
  
  // ADQUISICIÓN DUAL: dos canvas para rutas separadas
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const extractionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const extractionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  
  // Canvas legacy para compatibilidad
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  
  const frameLoopRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const frameTimestampHistoryRef = useRef<number[]>([]);
  const videoSchedulerRef = useRef<VideoFrameScheduler | null>(null);
  const extractionResRef = useRef<ExtractionResolutionController>(new ExtractionResolutionController());
  
  // Scheduler para tareas por frame/ventana
  const schedulerRef = useRef<{
    frameTasks: (() => void)[];
    windowTasks: (() => void)[];
    lastWindowTime: number;
  }>({
    frameTasks: [],
    windowTasks: [],
    lastWindowTime: 0
  });

  const EMA_ALPHA = 0.3;
  const emaRef = useRef({
    bpm: 0, spo2: 0, systolic: 0, diastolic: 0,
    glucose: 0, cholesterol: 0, triglycerides: 0,
  });

  const applyEMA = useCallback((prev: number, next: number): number => {
    if (next === 0) return 0;
    if (prev === 0) return next;
    return Math.round(prev * (1 - EMA_ALPHA) + next * EMA_ALPHA);
  }, []);

  const estimateSampleRateFromFrames = useCallback((timestamp?: number): number => {
    if (!timestamp || !isFinite(timestamp)) return 30;
    const history = frameTimestampHistoryRef.current;
    if (history.length === 0 || timestamp > history[history.length - 1]) {
      history.push(timestamp);
      if (history.length > 24) history.shift();
    }
    if (history.length < 6) return 30;
    const deltas: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const d = history[i] - history[i - 1];
      if (d >= 8 && d <= 120) deltas.push(d);
    }
    if (deltas.length < 4) return 30;
    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)];
    return Math.max(15, Math.min(60, 1000 / Math.max(1, median)));
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
    processFrameDual, 
    isProcessing, 
    framesProcessed,
    getRGBStats,
    getPositionQuality,
    getPPGDebugInfo,
    applyCaptureContext,
  } = useSignalProcessor();
  
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState,
    reset: resetHeartBeat,
  } = useHeartBeatProcessor();
  
  const { 
    processSignal: processVitalSigns, 
    setRGBData,
    setUpstreamContext,
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    hasValidPressureEstimate,
    lastValidResults,
    startCalibration,
    getCalibrationProgress,
    setHeartRuntime,
    ingestBeatOpticalRatio,
  } = useVitalSignsProcessor();
  
  const { saveMeasurement } = useSaveMeasurement();
  const { analysis, isAnalyzing, analyzeVitals, clearAnalysis } = useHealthAnalysis();
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [showPpgDebug, setShowPpgDebug] = useState(false);

  useEffect(() => {
    // Inicializar canvas de detección (resolución reducida)
    if (!detectionCanvasRef.current) {
      detectionCanvasRef.current = document.createElement('canvas');
      detectionCanvasRef.current.width = 160;
      detectionCanvasRef.current.height = 120;
      detectionCtxRef.current = detectionCanvasRef.current.getContext('2d', { 
        willReadFrequently: true,
        alpha: false 
      });
    }
    
    // Inicializar canvas de extracción (tamaño inicial; se reajusta en el loop)
    if (!extractionCanvasRef.current) {
      extractionCanvasRef.current = document.createElement('canvas');
      extractionCanvasRef.current.width = 320;
      extractionCanvasRef.current.height = 240;
      extractionCtxRef.current = extractionCanvasRef.current.getContext('2d', { 
        willReadFrequently: true,
        alpha: false 
      });
    }
    
    // Canvas legacy para compatibilidad
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 320;
      canvasRef.current.height = 240;
      ctxRef.current = canvasRef.current.getContext('2d', { 
        willReadFrequently: true,
        alpha: false 
      });
    }
  }, []);

  const enterFullScreen = async () => {
    if (isFullscreen) return;
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
    
    const detectionCanvas = detectionCanvasRef.current;
    const detectionCtx = detectionCtxRef.current;
    const extractionCanvas = extractionCanvasRef.current;
    const extractionCtx = extractionCtxRef.current;
    
    if (!detectionCanvas || !detectionCtx || !extractionCanvas || !extractionCtx) {
      isProcessingRef.current = false;
      return;
    }

    // Scheduler: ejecuta tareas por ventana (cada ~1s)
    const executeWindowTasks = () => {
      const now = performance.now();
      if (now - schedulerRef.current.lastWindowTime >= 1000) {
        schedulerRef.current.lastWindowTime = now;
        for (const task of schedulerRef.current.windowTasks) {
          try { task(); } catch (e) { console.error('Window task error:', e); }
        }
      }
    };

    const sched = new VideoFrameScheduler();
    videoSchedulerRef.current = sched;

    const captureOneFrame = (frameTimestampInput?: number, _meta?: unknown) => {
      if (!isProcessingRef.current) return;
      const video = cameraRef.current?.getVideoElement();
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        frameLoopRef.current = requestAnimationFrame(() => captureOneFrame(performance.now()));
        return;
      }

      const frameTimestamp =
        typeof frameTimestampInput === 'number' && isFinite(frameTimestampInput) ? frameTimestampInput : performance.now();

      try {
        detectionCtx.drawImage(video, 0, 0, detectionCanvas.width, detectionCanvas.height);
        const detectionImageData = detectionCtx.getImageData(0, 0, detectionCanvas.width, detectionCanvas.height);

        const extCtl = extractionResRef.current;
        const tier = extCtl.getTier();
        if (extractionCanvas.width !== tier.outWidth || extractionCanvas.height !== tier.outHeight) {
          extractionCanvas.width = tier.outWidth;
          extractionCanvas.height = tier.outHeight;
          extractionCtxRef.current = extractionCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
        }
        const extCtx = extractionCtxRef.current;
        if (!extCtx) return;

        const crop = extCtl.computeCentralCrop(video.videoWidth, video.videoHeight, detectionCanvas.width, detectionCanvas.height);
        extCtx.drawImage(
          video,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          0,
          0,
          extractionCanvas.width,
          extractionCanvas.height
        );
        const extractionImageData = extCtx.getImageData(0, 0, extractionCanvas.width, extractionCanvas.height);

        const vm = sched.getMetrics();
        applyCaptureContext({
          detectionWidth: detectionCanvas.width,
          detectionHeight: detectionCanvas.height,
          extractionWidth: extractionCanvas.width,
          extractionHeight: extractionCanvas.height,
          cropSource: { sx: crop.sx, sy: crop.sy, sw: crop.sw, sh: crop.sh },
          extractionTierId: tier.id,
          upscaleFromDetection: crop.upscaleFromDetection,
          extractionMode: `${vm.mode}|${extCtl.getTierId()}`,
        });

        processFrameDual(detectionImageData, extractionImageData, frameTimestamp);

        const pd = getPPGDebugInfo();
        const prof = pd?.profiler as Record<string, number> | undefined;
        const totalMs = prof?.total ?? 0;
        if (totalMs > 42) extractionResRef.current.stepDown();
        else if (totalMs > 0 && totalMs < 18 && vm.effectiveFps > 25) extractionResRef.current.stepUp();

        for (const task of schedulerRef.current.frameTasks) {
          try { task(); } catch (e) { console.error('Frame task error:', e); }
        }
        executeWindowTasks();
      } catch (e) {
        console.error('Frame capture error:', e);
      }
    };

    const boot = () => {
      const v = cameraRef.current?.getVideoElement();
      if (!isProcessingRef.current) return;
      if (!v || v.readyState < 2 || v.videoWidth === 0) {
        frameLoopRef.current = requestAnimationFrame(boot);
        return;
      }
      sched.start(v, (ts) => {
        if (!isProcessingRef.current) return;
        captureOneFrame(ts);
      });
    };
    boot();

    console.log('🎬 Dual acquisition (det baja + ext crop alta) + VideoFrameScheduler');
  }, [processFrameDual, applyCaptureContext, getPPGDebugInfo]);

  const stopFrameLoop = useCallback(() => {
    isProcessingRef.current = false;
    videoSchedulerRef.current?.stop();
    videoSchedulerRef.current = null;
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
    frameTimestampHistoryRef.current = [];
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SINUS_STABLE|0" }));
    startProcessing();
    setIsCameraOn(true);
    setIsMonitoring(true);
    if (measurementTimerRef.current) clearInterval(measurementTimerRef.current);
    measurementTimerRef.current = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    setIsCalibrating(true);
    startCalibration();
    setTimeout(() => setIsCalibrating(false), 3000);
  }, [isMonitoring, startProcessing, startCalibration, enterFullScreen]);

  const handleStreamReady = useCallback((stream: MediaStream) => {
    console.log('📹 Stream recibido');
    setCameraStream(stream);
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
  }, [startFrameLoop]);

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
    // Eliminado forceCalibrationCompletion - no se permite bypass de calibración
    const savedResults = resetVitalSigns();
    if (savedResults || vitalSigns.spo2 > 0) {
      const dataToSave = savedResults || vitalSigns;
      await saveMeasurement({
        heartRate,
        vitalSigns: dataToSave,
        signalQuality: lastSignal?.quality ?? undefined
      });
    }
    setIsCameraOn(false);
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setIsMonitoring(false);
    setIsCalibrating(false);
    frameTimestampHistoryRef.current = [];
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
  }, [isMonitoring, isCalibrating, cameraStream, stopFrameLoop, stopProcessing, resetVitalSigns, saveMeasurement, heartRate, vitalSigns, lastSignal]);

  const handleReset = useCallback(() => {
    console.log('🔄 Reset completo...');
    stopFrameLoop();
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    stopProcessing();
    fullResetVitalSigns();
    resetHeartBeat();
    emaRef.current = { bpm: 0, spo2: 0, systolic: 0, diastolic: 0, glucose: 0, cholesterol: 0, triglycerides: 0 };
    frameTimestampHistoryRef.current = [];
    setIsCameraOn(false);
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
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
    setHeartbeatSignal(0);
    setBeatMarker(0);
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
    setCalibrationProgress(0);
    arrhythmiaDetectedRef.current = false;
    console.log('✅ Reset completado');
  }, [cameraStream, stopFrameLoop, stopProcessing, fullResetVitalSigns, resetHeartBeat]);

  const vitalSignsFrameCounter = useRef<number>(0);
  const unstableFrameCounter = useRef<number>(0);
  const UNSTABLE_ZERO_THRESHOLD = 15;
  const VITALS_PROCESS_EVERY_N_FRAMES = 3;
  
  useEffect(() => {
    if (!lastSignal || !isMonitoring) return;
    
    const signalValue = lastSignal.filteredValue;
    const ls = lastSignal as ProcessedSignal & {
      clipHighRatio?: number;
      clipLowRatio?: number;
      pressureState?: 'LOW_PRESSURE' | 'OPTIMAL_PRESSURE' | 'HIGH_PRESSURE';
      estimatedSampleRate?: number;
      sourceStability?: number;
    };
    const positionQuality = getPositionQuality();
    const ext = ls.extendedContactState;
    const win = ls.pipelineDebug?.windowSQI;
    const windowGate = win ? win.gating !== 'reject' && win.score >= 0.26 : false;
    const stableHumanSignal =
      ls.contactState === 'STABLE_CONTACT' &&
      ext === 'MEASUREMENT_READY' &&
      windowGate &&
      (lastSignal.quality ?? 0) >= 10 &&
      (lastSignal.perfusionIndex ?? 0) >= 0.12;

    const clipHigh = ls.clipHighRatio ?? 0;
    const clipLow = ls.clipLowRatio ?? 0;
    const ppgPressure = ls.pressureState;
    const pressureOptimal =
      ppgPressure === 'OPTIMAL_PRESSURE' ||
      (positionQuality.locked && !positionQuality.drifting && positionQuality.qualityScore >= 0.55);
    const sourceStability = Math.max(
      0,
      Math.min(1, (ls.sourceStability ?? positionQuality.qualityScore) ?? 0)
    );
    const sampleRate =
      (ls.estimatedSampleRate && ls.estimatedSampleRate >= 15 ? ls.estimatedSampleRate : null) ??
      estimateSampleRateFromFrames(lastSignal.timestamp);

    const pd = ls.pipelineDebug;
    const fusionMeta = pd?.fusionMeta as { phaseAlignmentQuality?: number } | undefined;
    const specWin = pd?.windowSQI?.spectral as
      | {
          spectralDominanceScore?: number;
          detectorAgreementScore?: number;
          dominantFrequencyStability?: number;
        }
      | undefined;
    const spectralQualityAggregate = specWin
      ? Math.max(
          0,
          Math.min(
            1,
            (specWin.spectralDominanceScore ?? 0) * 0.34 +
              (specWin.detectorAgreementScore ?? 0) * 0.33 +
              (specWin.dominantFrequencyStability ?? 0) * 0.33
          )
        )
      : 0.45;

    const heartBeatResult = processHeartBeat(
      signalValue,
      ls.contactState,
      lastSignal.timestamp,
      {
        quality: lastSignal.quality,
        contactState: ls.contactState,
        motionArtifact: lastSignal.motionArtifact,
        pressureState: ppgPressure ?? (pressureOptimal ? 'OPTIMAL_PRESSURE' : 'LOW_PRESSURE'),
        clipHigh,
        clipLow,
        perfusionIndex: lastSignal.perfusionIndex,
        positionDrifting: positionQuality.drifting,
        windowSQI: ls.pipelineDebug?.windowSQI?.score ?? 0,
        fingerMeasurementState: ext,
        effectiveSampleRate: ls.estimatedSampleRate,
        phaseAlignmentQuality: fusionMeta?.phaseAlignmentQuality ?? 0.55,
        spectralQualityAggregate,
      }
    );

    setHeartbeatSignal(stableHumanSignal ? heartBeatResult.filteredValue : 0);

    if (!stableHumanSignal) {
      unstableFrameCounter.current++;
      if (unstableFrameCounter.current >= UNSTABLE_ZERO_THRESHOLD) {
        setHeartRate(0);
        vitalSignsFrameCounter.current = 0;
        setBeatMarker(0);
        setRRIntervals([]);
        setArrhythmiaCount("--");
        if (arrhythmiaDetectedRef.current) {
          arrhythmiaDetectedRef.current = false;
          setArrhythmiaState(false);
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
      }
      return;
    }

    unstableFrameCounter.current = 0;
    const smoothedBPM = applyEMA(emaRef.current.bpm, heartBeatResult.bpm);
    emaRef.current.bpm = smoothedBPM;
    setHeartRate(smoothedBPM);

    if (heartBeatResult.isPeak) {
      ingestBeatOpticalRatio();
      setBeatMarker(1);
      setTimeout(() => setBeatMarker(0), 300);
      totalBeatsRef.current++;
      const currentArrCount = vitalSigns.arrhythmiaCount ?? 0;
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
      const detectorAgreement = heartBeatResult.detectorAgreement ?? heartBeatResult.debug.detectorAgreement ?? 0;
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

      setUpstreamContext({
        contactStable: stableHumanSignal,
        pressureOptimal,
        clipHighRatio: clipHigh,
        sourceStability,
        avgBeatSQI: heartBeatResult.beatSQI ?? heartBeatResult.debug.lastBeatSQI ?? 0,
        beatCount: heartBeatResult.debug.beatsAccepted ?? heartBeatResult.rrData?.intervals.length ?? 0,
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

      const vitals = processVitalSigns(lastSignal.filteredValue, usableRRData, beatInputs);

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

          const isArrhythmiaDetected = !NON_ALERT_RHYTHMS.has(rhythmLabel);
          if (isArrhythmiaDetected !== arrhythmiaDetectedRef.current) {
            arrhythmiaDetectedRef.current = isArrhythmiaDetected;
            setArrhythmiaState(isArrhythmiaDetected);

            if (isArrhythmiaDetected) {
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
  }, [lastSignal, isMonitoring, processHeartBeat, processVitalSigns, setArrhythmiaState, setRGBData, setUpstreamContext, setHeartRuntime, ingestBeatOpticalRatio, getRGBStats, getPositionQuality, estimateSampleRateFromFrames, computeRRStability, applyEMA, vitalSigns.arrhythmiaCount]);

  useEffect(() => {
    if (isMonitoring && elapsedTime >= 60) {
      finalizeMeasurement();
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
      {!isFullscreen && (
        <button onClick={enterFullScreen} className="fixed inset-0 z-50 w-full h-full flex items-center justify-center bg-black/90 text-white">
          <div className="text-center p-4 bg-primary/20 rounded-lg backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
            <p className="text-lg font-semibold">Toca para modo pantalla completa</p>
          </div>
        </button>
      )}

      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <CameraView ref={cameraRef} onStreamReady={handleStreamReady} isMonitoring={isCameraOn} />
        </div>

        {isMonitoring && (() => {
          const pq = getPositionQuality();
          const isDrifting = pq.drifting;
          const isLocked = pq.locked && !isDrifting;
          const showGuidance = !isLocked || isDrifting;
          return showGuidance || isLocked ? (
            <div className="absolute top-1 left-0 right-0 z-20 flex justify-center pointer-events-none">
              <div className={`px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider shadow-lg backdrop-blur-md border ${
                isLocked ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' :
                isDrifting ? 'bg-red-500/20 border-red-500/40 text-red-300 animate-pulse' :
                pq.qualityScore > 0.4 ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' :
                'bg-red-500/20 border-red-500/40 text-red-300'
              }`}>
                <span className="flex items-center gap-1.5">
                  {isLocked ? <Shield className="w-3 h-3" /> : isDrifting ? <AlertTriangle className="w-3 h-3" /> : <Activity className="w-3 h-3 animate-pulse" />}
                  {pq.guidance}
                </span>
              </div>
            </div>
          ) : null;
        })()}

        <div className="relative z-10 h-full">
          <div className="flex-1 h-full">
            <button
              type="button"
              onClick={() => setShowPpgDebug((v) => !v)}
              className="fixed bottom-[72px] right-2 z-30 px-2 py-1 text-[10px] bg-slate-900/95 text-amber-200 rounded border border-slate-600 font-mono"
            >
              {showPpgDebug ? 'DBG ▾' : 'DBG ▴'}
            </button>
            {showPpgDebug && isMonitoring && lastSignal && (() => {
              const dbg = getPPGDebugInfo();
              const pd = lastSignal.pipelineDebug;
              return (
                <div className="fixed bottom-2 left-1 right-1 z-30 max-h-[40vh] overflow-y-auto bg-black/92 text-[10px] text-lime-100 font-mono p-2 rounded border border-slate-600 shadow-xl">
                  <div className="text-amber-300 font-bold mb-1">PPG / contacto / ROI / fusión</div>
                  <div>estado_dedo: {pd?.fingerMeasurementState ?? '—'} | contact_export: {lastSignal.contactState}</div>
                  <div>ventana_SQI: {pd?.windowSQI ? `${(pd.windowSQI.score * 100).toFixed(0)}% ${pd.windowSQI.gating} [${pd.windowSQI.reasons.slice(0, 2).join('; ')}]` : '—'}</div>
                  <div>FPS~: {pd?.frameTiming?.effectiveFps?.toFixed(1) ?? '—'} | Δt_ms: {pd?.frameTiming?.intervalMs?.toFixed(1) ?? '—'} | drops≈{pd?.frameTiming?.droppedEstimate ?? 0}</div>
                  <div>
                    worker: {String(dbg?.workerMode)} {dbg?.workerFallbackReason ? `(${dbg.workerFallbackReason})` : ''} | q={dbg?.workerQueue ?? 0} | lat~ms{' '}
                    {dbg?.workerLatencyMs?.toFixed(1) ?? '—'}
                  </div>
                  <div>
                    cap: det {String((pd?.acquisition as { detectionWidth?: number })?.detectionWidth)}×
                    {String((pd?.acquisition as { detectionHeight?: number })?.detectionHeight)} | ext{' '}
                    {String((pd?.acquisition as { extractionWidth?: number })?.extractionWidth)}×
                    {String((pd?.acquisition as { extractionHeight?: number })?.extractionHeight)} | tier{' '}
                    {String((pd?.acquisition as { extractionTierId?: string })?.extractionTierId)} | mode{' '}
                    {String((pd?.acquisition as { extractionMode?: string })?.extractionMode)}
                  </div>
                  <div>
                    perf: {String(pd?.performanceProfile)} | refino: {String((pd?.roiReputation as { refinementStage?: string })?.refinementStage)} | ROI_sw/min{' '}
                    {String((pd?.roiReputation as { switchesPerMinute?: number })?.switchesPerMinute)}
                  </div>
                  <div>
                    espectral: f_dom≈{((pd?.windowSQI?.spectral as { dominantFrequencyHz?: number })?.dominantFrequencyHz ?? 0).toFixed(2)} Hz | acuerdo_temp/esp{' '}
                    {((pd?.windowSQI?.spectral as { detectorAgreementScore?: number })?.detectorAgreementScore ?? 0).toFixed(2)}
                  </div>
                  <div>
                    fusión: colapso {pd?.fusionCollapse ? 'SÍ' : 'no'} | faseQ{' '}
                    {((pd?.fusionMeta as { phaseAlignmentQuality?: number })?.phaseAlignmentQuality ?? 0).toFixed(2)} | acuerdo{' '}
                    {((pd?.fusionMeta as { sourceAgreement?: number })?.sourceAgreement ?? 0).toFixed(2)} | motivo{' '}
                    {String((pd?.fusionMeta as { fusionCollapseReason?: string })?.fusionCollapseReason || '—')}
                  </div>
                  <div>fuente: {lastSignal.activeSource ?? '—'}</div>
                  <div className="mt-1 text-slate-400">top ROI (id/score/clip):</div>
                  <div className="whitespace-pre-wrap break-all">
                    {(pd?.topRois ?? []).slice(0, 5).map((r) => `${r.id}:${r.score.toFixed(2)}/${r.clipRatio.toFixed(2)}`).join(' | ')}
                  </div>
                  <div className="mt-1 text-slate-400">pesos fusión (muestra):</div>
                  <div className="whitespace-pre-wrap break-all">
                    {pd?.fusionWeights ? JSON.stringify(Object.fromEntries(Object.entries(pd.fusionWeights).filter(([, w]) => w > 0.04).slice(0, 8))) : '—'}
                  </div>
                  <div className="mt-1 text-slate-400">profiler_ms (EWMA):</div>
                  <div>{dbg?.profiler ? JSON.stringify(dbg.profiler) : JSON.stringify(pd?.profiler ?? {})}</div>
                  <div className="mt-1">BPM_ui: {heartRate || '—'} | calidad_proc: {(lastSignal.quality ?? 0).toFixed(0)}</div>
                </div>
              );
            })()}
            <PPGSignalMeter 
              value={heartbeatSignal}
              quality={lastSignal?.quality ?? 0}
              isFingerDetected={lastSignal?.fingerDetected ?? false}
              onStartMeasurement={handleToggleMonitoring}
              onReset={handleReset}
              isMonitoring={isMonitoring}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
              diagnosticMessage={lastSignal?.diagnostics?.message}
              isPeak={beatMarker === 1}
              bpm={heartRate}
              spo2={vitalSigns.spo2}
              rrIntervals={rrIntervals}
            />
          </div>

          <div className="absolute inset-x-0 top-[55%] bottom-[60px] bg-black/10 px-4 py-6">
            <div className="grid grid-cols-3 gap-4 place-items-center">
              <VitalSign label="FRECUENCIA CARDÍACA" value={heartRate > 0 ? Math.round(heartRate) : "--"} unit="BPM" highlighted={showResults} />
              <VitalSign label="SPO2" value={vitalSigns.spo2 > 0 ? vitalSigns.spo2 : "--"} unit="%" highlighted={showResults} />
              <VitalSign 
                label="PRESIÓN ARTERIAL"
                value={vitalSigns.pressure && vitalSigns.pressure.systolic > 0 ? `${vitalSigns.pressure.systolic}/${vitalSigns.pressure.diastolic}` : "--/--"}
                unit="mmHg"
                highlighted={showResults}
                confidenceLevel={vitalSigns.pressure?.confidence}
                featureQuality={vitalSigns.pressure?.featureQuality}
              />
              <VitalSign label="GLUCOSA (EST.)" value={vitalSigns.glucose > 0 ? vitalSigns.glucose : "--"} unit="mg/dL" highlighted={showResults} isResearch={true} />
              <VitalSign
                label="COLEST./TRIGL. (EST.)"
                value={vitalSigns.lipids?.totalCholesterol > 0 || vitalSigns.lipids?.triglycerides > 0 ? `${vitalSigns.lipids?.totalCholesterol ?? "--"}/${vitalSigns.lipids?.triglycerides ?? "--"}` : "--/--"}
                unit="mg/dL"
                highlighted={showResults}
                isResearch={true}
              />
              <VitalSign label="ARRITMIAS" value={vitalSigns.arrhythmiaStatus ?? "SIN ARRITMIAS|0"} highlighted={showResults} />
            </div>
          </div>

          {showResults && measurementSummary && (() => {
            const { totalBeats, arrhythmiaBeats, normalPercent } = measurementSummary;
            const normalBeats = totalBeats - arrhythmiaBeats;
            const avgBpm = heartRate > 0 ? Math.round(heartRate) : '--';
            const statusColor = normalPercent >= 95 ? 'emerald' : normalPercent >= 80 ? 'yellow' : 'red';
            const statusText = vitalSigns.rhythm?.label ? vitalSigns.rhythm.label.split('_').join(' ') : (normalPercent >= 95 ? 'RITMO NORMAL' : normalPercent >= 80 ? 'LEVE IRREGULARIDAD' : 'IRREGULARIDAD DETECTADA');
            const statusIcon = normalPercent >= 95 ? CheckCircle2 : AlertTriangle;
            const StatusIcon = statusIcon;
            
            const statusBgClass = statusColor === 'emerald' ? 'bg-emerald-500/10' : statusColor === 'yellow' ? 'bg-yellow-500/10' : 'bg-red-500/10';
            const statusTextClass = statusColor === 'emerald' ? 'text-emerald-400' : statusColor === 'yellow' ? 'text-yellow-400' : 'text-red-400';
            const statusTextColorClass = statusColor === 'emerald' ? 'text-emerald-300' : statusColor === 'yellow' ? 'text-yellow-300' : 'text-red-300';
            
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
                <div className="bg-slate-950 border border-slate-700/50 rounded-2xl max-w-sm w-[92%] shadow-2xl overflow-hidden">
                  <div className={`px-4 py-3 ${statusBgClass} border-b border-slate-800`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusIcon className={`w-5 h-5 ${statusTextClass}`} />
                        <div>
                          <h3 className="text-white text-sm font-bold tracking-wide">MEDICIÓN COMPLETADA</h3>
                          <p className={`${statusTextColorClass} text-[10px] font-semibold tracking-wider`}>{statusText}</p>
                        </div>
                      </div>
                      <button onClick={() => setMeasurementSummary(null)} className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors">
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-900/80 rounded-xl p-3 text-center border border-slate-800/50">
                        <Heart className="w-4 h-4 text-red-400 mx-auto mb-1" fill="currentColor" />
                        <div className="text-white text-2xl font-bold leading-none">{avgBpm}</div>
                        <div className="text-white/70 text-[9px] mt-1 font-medium">BPM PROMEDIO</div>
                      </div>
                      <div className="bg-slate-900/80 rounded-xl p-3 text-center border border-slate-800/50">
                        <Activity className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
                        <div className="text-white text-2xl font-bold leading-none">
                          {vitalSigns.spo2 > 0 ? vitalSigns.spo2 : '--'}
                          <span className="text-sm text-white/70">%</span>
                        </div>
                        <div className="text-white/70 text-[9px] mt-1 font-medium">SpO₂</div>
                      </div>
                    </div>

                    {vitalSigns.pressure?.systolic > 0 && (
                      <div className="bg-slate-900/80 rounded-xl p-3 border border-slate-800/50 flex items-center gap-3">
                        <Shield className="w-5 h-5 text-blue-400" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-white/70 text-[9px] font-medium">PRESIÓN ARTERIAL</div>
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
                            <span className="text-xs text-white/70 ml-1">mmHg</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-slate-900/80 rounded-xl p-3 border border-slate-800/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white text-[10px] font-semibold tracking-wide">ANÁLISIS DE RITMO</span>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-white/70" />
                          <span className="text-white/70 text-[9px]">30s</span>
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
                        analyzeVitals({ heartRate, vitalSigns, quality: lastSignal?.quality ?? undefined });
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
      </div>
    </div>
  );
};

export default Index;
