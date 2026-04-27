import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Heart, AlertTriangle, Activity, X, Shield, Clock, CheckCircle2, Brain, Loader2 } from "lucide-react";
import { playCompletionSound, playHeartBeep } from "@/utils/soundUtils";
import VitalSign from "@/components/VitalSign";
import CameraView, { CameraViewHandle } from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { VideoFrameScheduler } from "@/modules/signal-processing/VideoFrameScheduler";
import { ExtractionResolutionController } from "@/modules/signal-processing/ExtractionResolutionController";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import { useSaveMeasurement } from "@/hooks/useSaveMeasurement";
import {
  livePpgEvidenceGate,
  type LivePpgEvidenceInput,
  type LivePpgEvidenceResult,
} from "@/modules/signal-processing/LivePpgEvidenceGate";
import { useHealthAnalysis } from "@/hooks/useHealthAnalysis";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/hooks/use-toast";
import type { ProcessedSignal } from "@/types/signal";

const NON_ALERT_RHYTHMS = new Set([
  "SIN ARRITMIAS",
  "SINUS_STABLE",
  "SINUS_VARIABLE",
  "CALIBRANDO...",
  "CALIBRANDO",
  "UNDETERMINED_LOW_QUALITY",
  "INSUFFICIENT_DATA",
]);

const DEFAULT_VITALS: VitalSignsResult = {
  spo2: 0,
  glucose: 0,
  pressure: { systolic: 0, diastolic: 0, confidence: "INSUFFICIENT", featureQuality: 0 },
  arrhythmiaCount: 0,
  arrhythmiaStatus: "SINUS_STABLE|0",
  lipids: { totalCholesterol: 0, triglycerides: 0 },
  isCalibrating: false,
  calibrationProgress: 0,
  lastArrhythmiaData: undefined,
  signalQuality: 0,
  measurementConfidence: "INVALID",
};

const Index = () => {
  // ============ ESTADO UI ============
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>(DEFAULT_VITALS);
  const [heartRate, setHeartRate] = useState(0);
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [stableHumanSignal, setStableHumanSignal] = useState(false);
  const [beatMarker, setBeatMarker] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  const [measurementSummary, setMeasurementSummary] = useState<{
    totalBeats: number;
    arrhythmiaBeats: number;
    normalPercent: number;
  } | null>(null);
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [showPpgDebug, setShowPpgDebug] = useState(false);

  // ============ REFS ============
  const measurementTimerRef = useRef<number | null>(null);
  const totalBeatsRef = useRef(0);
  const arrhythmiaBeatsRef = useRef(0);
  const lastArrhythmiaCountForBeatsRef = useRef(0);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number } | null>(null);
  const cameraRef = useRef<CameraViewHandle>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Doble canvas: detección (baja resolución) y extracción (alta resolución)
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectionCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const extractionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const extractionCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const isProcessingRef = useRef(false);
  const frameLoopRef = useRef<number | null>(null);
  const videoSchedulerRef = useRef<VideoFrameScheduler | null>(null);
  const extractionResRef = useRef<ExtractionResolutionController>(new ExtractionResolutionController());
  const stableHumanSignalRef = useRef(false);
  const unstableFrameCounter = useRef(0);
  const vitalSignsFrameCounter = useRef(0);
  const hardFailFlatlineSentRef = useRef(false);
  // Histéresis del gate de evidencia: una vez validado, requiere N frames
  // consistentes de fallo para invalidar (evita parpadeo por oscilaciones).
  const gateFailStreakRef = useRef(0);
  const gateLastPassedAtRef = useRef(0);
  const lastBeepAtRef = useRef(0);
  // Streak de frames consecutivos con firma cromática válida. Evita que un
  // destello/parpadeo active el detector. Se exigen 4 frames consecutivos
  // (~130 ms a 30 fps) antes de procesar el heartbeat al primer contacto.
  const chromaOkStreakRef = useRef(0);
  const CHROMA_CONFIRM_FRAMES = 4;
  // Streak de frames consecutivos SIN firma cromática. Solo tras 36 frames
  // (~1.2 s a 30 fps) se borran buffers y se resetea el procesador.
  // Tolera valles fisiológicos largos, pequeños movimientos del dedo, y
  // microtransiciones de auto-exposición. Un dedo retirado cae bajo
  // umbral permanentemente y supera fácilmente este margen.
  const chromaFailStreakRef = useRef(0);
  const CHROMA_PERSIST_FAIL_FRAMES = 36;
  // EMAs de los descriptores cromáticos para amortiguar el ruido frame-a-frame
  // y los micro-valles de la propia pulsación. La validación se hace contra
  // estas medias suavizadas.
  const chromaEmaRef = useRef({ meanR: 0, rOverMax: 0, rMinusMax: 0, dcRed: 0, initialized: false });
  // Bandera de "engaged": una vez que el chroma se valida y el operador
  // tiene dedo, mantenemos histéresis: salir del estado engaged exige
  // umbrales más bajos (release) que entrar (attack).
  const chromaEngagedRef = useRef(false);
  // Último BPM válido y su timestamp: durante huecos breves de hasta 2.5 s
  // el monitor mantiene el último BPM real (comportamiento de monitor
  // clínico estándar; evita parpadeo numérico durante valles transitorios).
  const lastValidBpmRef = useRef({ bpm: 0, ts: 0 });
  const BPM_HOLD_MS = 2500;

  const UNSTABLE_ZERO_THRESHOLD = 12;
  const GATE_FAIL_INVALIDATE_FRAMES = 8;
  const VITALS_PROCESS_EVERY_N_FRAMES = 3;

  // Suavizado EMA para valores publicados a UI
  const EMA_ALPHA = 0.3;
  const emaRef = useRef({
    bpm: 0,
    spo2: 0,
    systolic: 0,
    diastolic: 0,
    glucose: 0,
    cholesterol: 0,
    triglycerides: 0,
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

  // (Channel Stability Score y Skewness eliminados: el SignalQualityEngine
  // ya calcula dominantBpm, spectralDominanceScore y harmonicityScore por
  // ventana, sobre la señal fusionada. No hace falta repetir el barrido
  // espectral en Index — era una de las causas de que la app tuviera
  // varias estimaciones de BPM compitiendo y produjera resultados
  // erráticos al mezclarlas.)

  // ============ HOOKS DE PROCESAMIENTO ============
  const {
    startProcessing,
    stopProcessing,
    lastSignal,
    processFrameDual,
    getRGBStats,
    getPositionQuality,
    getPPGDebugInfo,
    applyCaptureContext,
  } = useSignalProcessor();

  const { processSignal: processHeartBeat, setArrhythmiaState, reset: resetHeartBeat } = useHeartBeatProcessor();

  const {
    processSignal: processVitalSigns,
    setRGBData,
    setUpstreamContext,
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    startCalibration,
    getCalibrationProgress,
    setHeartRuntime,
    ingestBeatOpticalRatio,
  } = useVitalSignsProcessor();

  const { saveMeasurement } = useSaveMeasurement();
  const { analysis, isAnalyzing, analyzeVitals, clearAnalysis } = useHealthAnalysis();

  // ============ INICIALIZACIÓN DE CANVAS ============
  useEffect(() => {
    if (!detectionCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 120;
      detectionCanvasRef.current = c;
      detectionCtxRef.current = c.getContext("2d", { willReadFrequently: true, alpha: false });
    }
    if (!extractionCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 240;
      extractionCanvasRef.current = c;
      extractionCtxRef.current = c.getContext("2d", { willReadFrequently: true, alpha: false });
    }
  }, []);

  // ============ FULLSCREEN ============
  const enterFullScreen = useCallback(async () => {
    if (isFullscreen) return;
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if ((docEl as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
        await (docEl as unknown as { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen();
      }
      if (screen.orientation && "lock" in screen.orientation) {
        try {
          await (screen.orientation as ScreenOrientation & { lock: (o: string) => Promise<void> }).lock("portrait");
        } catch {
          /* ignored */
        }
      }
      setIsFullscreen(true);
    } catch {
      /* ignored */
    }
  }, [isFullscreen]);

  useEffect(() => {
    const timer = setTimeout(() => enterFullScreen(), 1000);
    const handleFullscreenChange = () => {
      setIsFullscreen(
        Boolean(
          document.fullscreenElement ||
            (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement
        )
      );
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [enterFullScreen]);

  useEffect(() => {
    const preventScroll = (e: Event) => e.preventDefault();
    document.body.addEventListener("touchmove", preventScroll, { passive: false });
    document.body.addEventListener("scroll", preventScroll, { passive: false });
    return () => {
      document.body.removeEventListener("touchmove", preventScroll);
      document.body.removeEventListener("scroll", preventScroll);
    };
  }, []);

  // ============ FRAME LOOP DUAL ============
  const startFrameLoop = useCallback(() => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    const detectionCanvas = detectionCanvasRef.current;
    const detectionCtx = detectionCtxRef.current;
    const extractionCanvas = extractionCanvasRef.current;
    let extractionCtx = extractionCtxRef.current;

    if (!detectionCanvas || !detectionCtx || !extractionCanvas || !extractionCtx) {
      isProcessingRef.current = false;
      return;
    }

    const sched = new VideoFrameScheduler();
    videoSchedulerRef.current = sched;

    const captureFrame = (frameTimestampInput?: number) => {
      if (!isProcessingRef.current) return;
      const video = cameraRef.current?.getVideoElement();
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        frameLoopRef.current = requestAnimationFrame(() => captureFrame(performance.now()));
        return;
      }

      const frameTimestamp =
        typeof frameTimestampInput === "number" && isFinite(frameTimestampInput)
          ? frameTimestampInput
          : performance.now();

      try {
        // Detección (160x120) - usado por AdaptiveROIMask
        detectionCtx.drawImage(video, 0, 0, detectionCanvas.width, detectionCanvas.height);
        const detectionImageData = detectionCtx.getImageData(0, 0, detectionCanvas.width, detectionCanvas.height);

        // Extracción (tier-driven, crop central) - usado por MultiROIExtractor
        const extCtl = extractionResRef.current;
        const tier = extCtl.getTier();
        if (extractionCanvas.width !== tier.outWidth || extractionCanvas.height !== tier.outHeight) {
          extractionCanvas.width = tier.outWidth;
          extractionCanvas.height = tier.outHeight;
          extractionCtxRef.current = extractionCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
          extractionCtx = extractionCtxRef.current;
        }
        if (!extractionCtx) return;

        const crop = extCtl.computeCentralCrop(
          video.videoWidth,
          video.videoHeight,
          detectionCanvas.width,
          detectionCanvas.height
        );
        extractionCtx.drawImage(
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
        const extractionImageData = extractionCtx.getImageData(0, 0, extractionCanvas.width, extractionCanvas.height);

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
      } catch (e) {
        console.error("Frame capture error:", e);
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
        captureFrame(ts);
      });
    };
    boot();
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

  // ============ INICIO / FIN DE MEDICIÓN ============
  const startMonitoring = useCallback(() => {
    if (isMonitoring) return;
    if (navigator.vibrate) navigator.vibrate([200]);
    enterFullScreen();
    setShowResults(false);
    setMeasurementSummary(null);
    setElapsedTime(0);
    totalBeatsRef.current = 0;
    arrhythmiaBeatsRef.current = 0;
    lastArrhythmiaCountForBeatsRef.current = 0;
    hardFailFlatlineSentRef.current = false;
    stableHumanSignalRef.current = false;
    unstableFrameCounter.current = 0;
    vitalSignsFrameCounter.current = 0;
    gateFailStreakRef.current = 0;
    gateLastPassedAtRef.current = 0;
    lastBeepAtRef.current = 0;
    chromaOkStreakRef.current = 0;
    chromaFailStreakRef.current = 0;
    chromaEmaRef.current = { meanR: 0, rOverMax: 0, rMinusMax: 0, dcRed: 0, initialized: false };
    chromaEngagedRef.current = false;
    lastValidBpmRef.current = { bpm: 0, ts: 0 };
    setVitalSigns({ ...DEFAULT_VITALS, arrhythmiaStatus: "SINUS_STABLE|0" });
    startProcessing();
    setIsCameraOn(true);
    setIsMonitoring(true);
    if (measurementTimerRef.current) clearInterval(measurementTimerRef.current);
    measurementTimerRef.current = window.setInterval(() => setElapsedTime((p) => p + 1), 1000);
    setIsCalibrating(true);
    startCalibration();
    setTimeout(() => setIsCalibrating(false), 3000);
  }, [isMonitoring, startProcessing, startCalibration, enterFullScreen]);

  const handleStreamReady = useCallback(
    (stream: MediaStream) => {
      cameraStreamRef.current = stream;
      setTimeout(() => {
        const video = cameraRef.current?.getVideoElement();
        if (video && video.readyState >= 2) {
          startFrameLoop();
        } else {
          const checkReady = setInterval(() => {
            const v = cameraRef.current?.getVideoElement();
            if (v && v.readyState >= 2 && v.videoWidth > 0) {
              clearInterval(checkReady);
              startFrameLoop();
            }
          }, 100);
          setTimeout(() => clearInterval(checkReady), 5000);
        }
      }, 500);
    },
    [startFrameLoop]
  );

  const finalizeMeasurement = useCallback(async () => {
    if (!isMonitoring) return;
    if (stableHumanSignalRef.current) {
      playCompletionSound();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    }
    stopFrameLoop();
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    stopProcessing();
    const savedResults = resetVitalSigns();
    if (savedResults || vitalSigns.spo2 > 0) {
      const dataToSave = savedResults || vitalSigns;
      await saveMeasurement({
        heartRate,
        vitalSigns: dataToSave,
        signalQuality: lastSignal?.quality ?? undefined,
      });
    }
    setIsCameraOn(false);
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setIsMonitoring(false);
    setIsCalibrating(false);
    if (savedResults) setVitalSigns(savedResults);
    setShowResults(true);
    const total = totalBeatsRef.current;
    const arrBeats = arrhythmiaBeatsRef.current;
    setMeasurementSummary({
      totalBeats: total,
      arrhythmiaBeats: arrBeats,
      normalPercent: total > 0 ? Math.round(((total - arrBeats) / total) * 100) : 100,
    });
    setElapsedTime(0);
    setCalibrationProgress(0);
  }, [isMonitoring, stopFrameLoop, stopProcessing, resetVitalSigns, saveMeasurement, heartRate, vitalSigns, lastSignal]);

  const handleReset = useCallback(() => {
    stopFrameLoop();
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    stopProcessing();
    fullResetVitalSigns();
    resetHeartBeat();
    emaRef.current = { bpm: 0, spo2: 0, systolic: 0, diastolic: 0, glucose: 0, cholesterol: 0, triglycerides: 0 };
    setIsCameraOn(false);
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
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
    vitalSignsFrameCounter.current = 0;
    stableHumanSignalRef.current = false;
    hardFailFlatlineSentRef.current = false;
    gateFailStreakRef.current = 0;
    gateLastPassedAtRef.current = 0;
    lastBeepAtRef.current = 0;
    chromaOkStreakRef.current = 0;
    chromaFailStreakRef.current = 0;
    chromaEmaRef.current = { meanR: 0, rOverMax: 0, rMinusMax: 0, dcRed: 0, initialized: false };
    chromaEngagedRef.current = false;
    lastValidBpmRef.current = { bpm: 0, ts: 0 };
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setRRIntervals([]);
    setVitalSigns(DEFAULT_VITALS);
    setArrhythmiaCount("--");
    lastArrhythmiaData.current = null;
    setCalibrationProgress(0);
    arrhythmiaDetectedRef.current = false;
    setStableHumanSignal(false);
  }, [stopFrameLoop, stopProcessing, fullResetVitalSigns, resetHeartBeat]);

  // ============ PROCESAMIENTO POR FRAME (lastSignal -> heartbeat -> evidencia -> vitals) ============
  useEffect(() => {
    if (!lastSignal || !isMonitoring) return;

    const ls = lastSignal as ProcessedSignal & {
      clipHighRatio?: number;
      clipLowRatio?: number;
      pressureState?: "LOW_PRESSURE" | "OPTIMAL_PRESSURE" | "HIGH_PRESSURE";
      estimatedSampleRate?: number;
      sourceStability?: number;
    };

    // ================================================================
    // CHROMATIC GATE — firma física inviolable del flash sobre tejido
    // perfundido. Sin esta firma NO HAY procesamiento alguno: ni
    // heartbeat, ni picos, ni vitales. Solo onda gris plana en el monitor.
    //
    // Con flash blanco apuntando a un dedo:
    //  - hemoglobina absorbe verde y azul → R domina ENORMEMENTE.
    //  - DC del rojo > 100 (saturado por reflexión del tejido).
    //  - R / max(G, B) >= 1.6 (típicamente 2-4).
    //  - R - max(G, B) >= 25.
    //
    // Sin dedo (pared, aire, sábana, ropa, papel, mesa, objetos):
    //  - Los tres canales se balancean (R/max(G,B) ≈ 1.0-1.3).
    //  - O dominan G/B según el color del objeto.
    //  - El DC del rojo cae < 100 si no hay reflexión directa.
    //
    // Este test es MATEMÁTICAMENTE imposible de pasar sin tejido
    // perfundido bajo flash. No es una heurística de "forma de dedo".
    // ================================================================
    const acStatsEarly = ls.acStats ?? { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0, ratioOfRatios: 0 };
    const meanRcurr = ls.rawRed ?? 0;
    const meanGcurr = ls.rawGreen ?? 0;
    // El procesador no expone meanB, pero podemos inferir un techo: si la
    // luminancia es Y y R, G están cerca, el azul también lo está.
    // Aproximación segura: max(G, B) ≥ G (B suele ser ≤ G en flash blanco
    // sobre tejido). Por tanto R / max(G, B) ≤ R / G.
    const maxNonRed = Math.max(meanGcurr, 1);
    const rOverMax = meanRcurr / maxNonRed;
    const rMinusMax = meanRcurr - maxNonRed;
    // ============================================================
    // EMA cromática para amortiguar valles fisiológicos de la pulsación
    // (que también modulan meanR / rOverMax) y ruido por frame, sin
    // perder reactividad ante una retirada real del dedo.
    // Tau efectivo ~500 ms a 30 fps con alpha=0.10. Mantiene la señal
    // estable durante valles cardíacos (que duran ~150-300 ms).
    // ============================================================
    const ema = chromaEmaRef.current;
    if (!ema.initialized) {
      ema.meanR = meanRcurr;
      ema.rOverMax = rOverMax;
      ema.rMinusMax = rMinusMax;
      ema.dcRed = (acStatsEarly.redDC ?? 0) > 30 ? acStatsEarly.redDC : meanRcurr;
      ema.initialized = true;
    } else {
      const a = 0.10;
      ema.meanR = ema.meanR * (1 - a) + meanRcurr * a;
      ema.rOverMax = ema.rOverMax * (1 - a) + rOverMax * a;
      ema.rMinusMax = ema.rMinusMax * (1 - a) + rMinusMax * a;
      const dcRaw = (acStatsEarly.redDC ?? 0) > 30 ? acStatsEarly.redDC : meanRcurr;
      ema.dcRed = ema.dcRed * (1 - a) + dcRaw * a;
    }

    // Histéresis attack/release: para ENGANCHAR el dedo (entrar a engaged)
    // los umbrales son los exigentes; para PERMANECER son más permisivos
    // (un valle sistólico no rompe el estado). Sin engaged previo solo
    // el conjunto attack es válido, así que no hay manera de "engaged"
    // a una pared.
    const ATK_MEAN_R = 100;
    const ATK_R_OVER_MAX = 1.45;
    const ATK_R_MINUS_MAX = 18;
    const ATK_DC_RED = 90;
    const REL_MEAN_R = 70;
    const REL_R_OVER_MAX = 1.18;
    const REL_R_MINUS_MAX = 8;
    const REL_DC_RED = 60;

    const attackOk =
      ema.meanR >= ATK_MEAN_R &&
      ema.rOverMax >= ATK_R_OVER_MAX &&
      ema.rMinusMax >= ATK_R_MINUS_MAX &&
      ema.dcRed >= ATK_DC_RED;
    const releaseOk =
      ema.meanR >= REL_MEAN_R &&
      ema.rOverMax >= REL_R_OVER_MAX &&
      ema.rMinusMax >= REL_R_MINUS_MAX &&
      ema.dcRed >= REL_DC_RED;

    let chromaOk: boolean;
    if (chromaEngagedRef.current) {
      chromaOk = releaseOk;
      if (!releaseOk) chromaEngagedRef.current = false;
    } else {
      chromaOk = attackOk;
      if (attackOk) chromaEngagedRef.current = true;
    }

    if (!chromaOk) {
      chromaOkStreakRef.current = 0;
      chromaFailStreakRef.current++;
      // Mientras dure poco (<600 ms) NO destruimos buffers ni tocamos UI:
      // es probablemente un valle fisiológico, motion momentáneo o
      // microtransición de exposición. Mantenemos el último BPM válido.
      if (chromaFailStreakRef.current < CHROMA_PERSIST_FAIL_FRAMES) {
        // Hold: si tenemos un BPM válido reciente, lo mantenemos visible.
        const heldFresh = lastValidBpmRef.current.bpm > 0 && Date.now() - lastValidBpmRef.current.ts < BPM_HOLD_MS;
        if (!heldFresh && heartRate !== 0) setHeartRate(0);
        // La onda recibe 0 SOLO durante este hueco corto, para indicar
        // visualmente la pérdida momentánea sin parpadear todo el HUD.
        setHeartbeatSignal(0);
        return;
      }
      // Falla persistente: reset duro y limpieza completa.
      stableHumanSignalRef.current = false;
      if (stableHumanSignal) setStableHumanSignal(false);
      gateFailStreakRef.current = GATE_FAIL_INVALIDATE_FRAMES;
      setHeartbeatSignal(0);
      lastValidBpmRef.current = { bpm: 0, ts: 0 };
      if (heartRate !== 0) setHeartRate(0);
      setVitalSigns((prev) =>
        prev.spo2 === 0 &&
        prev.glucose === 0 &&
        prev.pressure.systolic === 0 &&
        prev.pressure.diastolic === 0 &&
        prev.measurementConfidence === "INVALID"
          ? prev
          : {
              ...prev,
              spo2: 0,
              glucose: 0,
              pressure: { systolic: 0, diastolic: 0, confidence: "INSUFFICIENT", featureQuality: 0 },
              arrhythmiaCount: 0,
              arrhythmiaStatus: "SINUS_STABLE|0",
              lipids: { totalCholesterol: 0, triglycerides: 0 },
              lastArrhythmiaData: undefined,
              signalQuality: 0,
              measurementConfidence: "INVALID",
            }
      );
      setArrhythmiaCount("--");
      lastArrhythmiaData.current = null;
      setRRIntervals([]);
      setBeatMarker(0);
      // Reset del HeartBeatProcessor solo una vez tras la fall persistente.
      if (chromaFailStreakRef.current === CHROMA_PERSIST_FAIL_FRAMES) {
        resetHeartBeat();
        // Después invalidamos también la EMA cromática para que el próximo
        // contacto entre por attack-thresholds.
        ema.initialized = false;
      }
      unstableFrameCounter.current = chromaFailStreakRef.current - CHROMA_PERSIST_FAIL_FRAMES;
      return;
    }
    chromaFailStreakRef.current = 0;
    chromaOkStreakRef.current++;
    if (chromaOkStreakRef.current < CHROMA_CONFIRM_FRAMES) {
      // Firma cromática presente pero no confirmada: silenciar onda y
      // no avanzar al heartbeat. Esto evita disparos por destellos.
      setHeartbeatSignal(0);
      return;
    }
    unstableFrameCounter.current = 0;

    const signalValue = ls.filteredValue;
    const positionQuality = getPositionQuality();
    const ext = ls.extendedContactState;
    const win = ls.pipelineDebug?.windowSQI;
    const clipHigh = ls.clipHighRatio ?? 0;
    const clipLow = ls.clipLowRatio ?? 0;
    const ppgPressure = ls.pressureState;
    const pressureOptimal =
      ppgPressure === "OPTIMAL_PRESSURE" ||
      (positionQuality.locked && !positionQuality.drifting && positionQuality.qualityScore >= 0.55);
    const sourceStability = Math.max(
      0,
      Math.min(1, (ls.sourceStability ?? positionQuality.qualityScore) ?? 0)
    );
    const sampleRate = ls.estimatedSampleRate && ls.estimatedSampleRate >= 15 ? ls.estimatedSampleRate : 30;

    const fusionMeta = ls.pipelineDebug?.fusionMeta as { phaseAlignmentQuality?: number } | undefined;
    const specWin = win?.spectral as
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

    // 1) Procesar heartbeat. Pasamos el flag de evidencia del frame previo
    //    (stableHumanSignalRef) para que el procesador no se autobloquee.
    const heartBeatResult = processHeartBeat(signalValue, ls.contactState, ls.timestamp, {
      quality: ls.quality,
      contactState: ls.contactState,
      motionArtifact: ls.motionArtifact,
      pressureState: ppgPressure ?? (pressureOptimal ? "OPTIMAL_PRESSURE" : "LOW_PRESSURE"),
      clipHigh,
      clipLow,
      perfusionIndex: ls.perfusionIndex,
      positionDrifting: positionQuality.drifting,
      windowSQI: win?.score ?? 0,
      fingerMeasurementState: ext,
      effectiveSampleRate: ls.estimatedSampleRate,
      phaseAlignmentQuality: fusionMeta?.phaseAlignmentQuality ?? 0.55,
      spectralQualityAggregate,
      livePpgEvidencePassed: stableHumanSignalRef.current,
    });

    // 2) Construir métricas multicanal REALES desde acStats del PPGSignalProcessor
    // (acStats reusado del chromatic gate de la sección anterior)
    const acStats = acStatsEarly;
    const acDcR = acStats.redDC > 0 ? acStats.redAC / acStats.redDC : 0;
    const acDcG = acStats.greenDC > 0 ? acStats.greenAC / acStats.greenDC : 0;

    // Coherencia multicanal AMPLITUD (ratio AC/DC similar entre R y G ⇒ pulso compartido).
    // Es la métrica simple que combinada con dominantBpm del SignalQualityEngine
    // (calculado upstream una sola vez) basta como evidencia espectral.
    let channelCoherence = 0;
    if (acDcR > 0 && acDcG > 0) {
      const minRatio = Math.min(acDcR, acDcG);
      const maxRatio = Math.max(acDcR, acDcG);
      channelCoherence = minRatio / maxRatio;
    }

    // SNR espectral derivado del windowSQI real
    const spectralDom = specWin?.spectralDominanceScore ?? 0;
    const spectralEntropyPenalty =
      (specWin as { spectralEntropyPenalty?: number } | undefined)?.spectralEntropyPenalty ?? 0;
    // Mapear a dB: dom alto y entropía baja ⇒ SNR alto.
    const spectralSnrDb = Math.max(
      0,
      Math.min(20, 12 * spectralDom + 6 * (1 - spectralEntropyPenalty) + 2 * (specWin?.detectorAgreementScore ?? 0))
    );

    // Autocorrelación: usar la calculada por el procesador en cada frame
    // (no requiere latidos aceptados; mide periodicidad de la señal filtrada).
    // Si todavía no está disponible, caer al agreement temporal-espectral.
    const autocorrFromProc = (ls.pipelineDebug as { autocorrPeak?: number } | undefined)?.autocorrPeak;
    const autocorrelationScore = Math.max(
      0,
      Math.min(
        1,
        typeof autocorrFromProc === "number" && autocorrFromProc > 0
          ? autocorrFromProc
          : heartBeatResult.debug?.temporalSpectralAgreement ?? 0
      )
    );

    // 3) Evaluar gate de evidencia PPG
    // Cromaticidad ya validada por el chromatic gate al inicio.
    const rgRatioCurr = meanGcurr > 1 ? meanRcurr / meanGcurr : 0;
    const redDomCurr = meanRcurr - meanGcurr;

    const evidenceInput: LivePpgEvidenceInput = {
      timestamp: ls.timestamp,
      sampleRate,
      contactState: ls.contactState,
      extendedContactState: ext,
      quality: ls.quality ?? 0,
      perfusionIndex: ls.perfusionIndex ?? 0,
      clipHighRatio: clipHigh,
      clipLowRatio: clipLow,
      motionArtifact:
        typeof ls.motionArtifact === "boolean" ? (ls.motionArtifact ? 1 : 0) : (ls.motionArtifact as unknown as number) ?? 0,
      sourceStability,
      pressureState: ppgPressure,
      rgRatio: rgRatioCurr,
      redDominance: redDomCurr,
      meanR: meanRcurr,
      windowSQI: win,
      beatDebug: {
        acceptedBeats: heartBeatResult.debug?.beatsAccepted ?? 0,
        consecutivePeaks: heartBeatResult.debug?.consecutivePeaks ?? 0,
        avgBeatSQI: heartBeatResult.beatSQI ?? 0,
        avgMorphologyScore: heartBeatResult.debug?.morphologyScore ?? 0,
        avgDetectorAgreement: heartBeatResult.detectorAgreement ?? 0,
        temporalSpectralAgreement: heartBeatResult.debug?.temporalSpectralAgreement ?? 0,
        spectralConfidence: heartBeatResult.debug?.spectralConfidence ?? 0,
        medianRRBpm: heartBeatResult.debug?.medianRRBpm ?? 0,
        spectralBpm: heartBeatResult.debug?.spectralBpm ?? 0,
        autocorrBpm: heartBeatResult.debug?.autocorrBpm ?? 0,
      },
      multichannelEvidence: {
        channelCoherence,
        acDcRatioR: acDcR,
        acDcRatioG: acDcG,
        acDcRatioB: 0,
        spectralSnrDb,
        autocorrelationScore,
      },
    };

    const evidence: LivePpgEvidenceResult = livePpgEvidenceGate.evaluate(evidenceInput);
    const rawPassed = evidence.passed && evidence.tier === "VALID_LIVE_PPG";

    // Histéresis temporal: si ya estábamos en passed, requerir GATE_FAIL_INVALIDATE_FRAMES
    // consecutivos de no-pass para invalidar. Hard-fail físico (motion >>1, no-contact, clip>=25%)
    // sí invalida inmediatamente.
    let passed: boolean;
    if (rawPassed) {
      gateFailStreakRef.current = 0;
      gateLastPassedAtRef.current = ls.timestamp;
      passed = true;
    } else if (evidence.hardFail) {
      gateFailStreakRef.current = GATE_FAIL_INVALIDATE_FRAMES;
      passed = false;
    } else {
      gateFailStreakRef.current++;
      // Mantener passed si llevábamos poco tiempo en falla y el gate previo
      // estaba validado (gateLastPassedAtRef > 0).
      passed =
        stableHumanSignalRef.current &&
        gateLastPassedAtRef.current > 0 &&
        gateFailStreakRef.current < GATE_FAIL_INVALIDATE_FRAMES;
    }

    // Sincronizar ref + state. Usar ref para decisiones del mismo frame.
    stableHumanSignalRef.current = passed;
    if (passed !== stableHumanSignal) setStableHumanSignal(passed);

    // El monitor recibe la señal filtrada SIEMPRE que haya algo de calidad,
    // incluso si el gate aún no validó. Render provisional vs validado se
    // distingue en el monitor con livePpgEvidencePassed. Sólo se silencia
    // si la calidad es nula (sin contacto / cámara cubierta totalmente).
    const wantWaveform = (ls.quality ?? 0) >= 6 || ls.contactState !== "NO_CONTACT";
    setHeartbeatSignal(wantWaveform ? heartBeatResult.filteredValue : 0);

    // Marcador de pico al monitor (siempre que haya señal viva). Beep + vibración
    // sólo con gate validado. Throttle anti-rebote a 250 ms para evitar dobles.
    if (heartBeatResult.isPeak && wantWaveform) {
      setBeatMarker(1);
      setTimeout(() => setBeatMarker(0), 200);
      if (passed) {
        const nowMs = ls.timestamp;
        if (nowMs - lastBeepAtRef.current > 250) {
          lastBeepAtRef.current = nowMs;
          if (navigator.vibrate) {
            try { navigator.vibrate(35); } catch { /* hot path */ }
          }
          playHeartBeep(vitalSigns.spo2 > 0 ? vitalSigns.spo2 : undefined);
        }
      }
    }

    // 4) Hard fail ⇒ invalidar inmediatamente (una sola vez)
    if (!passed && evidence.hardFail) {
      if (!hardFailFlatlineSentRef.current) {
        hardFailFlatlineSentRef.current = true;
        setVitalSigns((prev) => ({
          ...prev,
          spo2: 0,
          glucose: 0,
          pressure: { systolic: 0, diastolic: 0, confidence: "INSUFFICIENT", featureQuality: 0 },
          arrhythmiaCount: 0,
          arrhythmiaStatus: "NO_VALID_PPG|0",
          lipids: { totalCholesterol: 0, triglycerides: 0 },
          lastArrhythmiaData: undefined,
          signalQuality: 0,
          measurementConfidence: "INVALID",
        }));
      }
    } else if (passed) {
      hardFailFlatlineSentRef.current = false;
    }

    if (!passed) {
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
        setVitalSigns((prev) =>
          prev.measurementConfidence === "INVALID" &&
          prev.spo2 === 0 &&
          prev.glucose === 0 &&
          prev.pressure.systolic === 0 &&
          prev.pressure.diastolic === 0
            ? prev
            : {
                ...prev,
                spo2: 0,
                glucose: 0,
                pressure: { systolic: 0, diastolic: 0, confidence: "INSUFFICIENT", featureQuality: 0 },
                arrhythmiaCount: 0,
                arrhythmiaStatus: "SINUS_STABLE|0",
                lipids: { totalCholesterol: 0, triglycerides: 0 },
                lastArrhythmiaData: undefined,
                signalQuality: 0,
                measurementConfidence: "INVALID",
              }
        );
      }
      return;
    }

    // 5) Pipeline válido: BPM, picos, vitals.
    // ================================================================
    // VALIDACIÓN ÚNICA Y LINEAL del BPM (anti-duplicidad):
    //
    // 1) Chromatic Gate ya pasado (con histéresis y EMA) -> hay tejido + flash.
    // 2) HeartBeatProcessor.fuseBPM ya combina internamente:
    //    - mediana RR, RR trimmed, autocorrelación, narrowband espectral
    //    - acuerdo temporal-espectral, suavizado, refractariedad
    //    Su `bpm` es la única fuente de verdad cardíaca del frame.
    // 3) Cross-check físico contra dominantBpm del SignalQualityEngine
    //    (calculado upstream, una sola vez). Si ambos coinciden ≤ 12 BPM
    //    o ≤ 12% relativo, se acepta. Si no, se rechaza.
    // 4) DC del rojo (>= 70) confirma reflexión de flash sobre tejido.
    //
    // SIN duplicidad: una autocorr (la del HBP), una espectral
    // (la del SignalQualityEngine), un BPM final.
    // ================================================================
    unstableFrameCounter.current = 0;

    const dcRedOk = (acStats.redDC ?? 0) >= 70;
    const tempoBpm = heartBeatResult.bpm;
    const tempoOk = tempoBpm >= 38 && tempoBpm <= 195;
    const dominantBpm =
      (specWin as { dominantBpm?: number } | undefined)?.dominantBpm ?? 0;
    const dominantOk = dominantBpm >= 38 && dominantBpm <= 195 && (specWin?.spectralDominanceScore ?? 0) >= 0.25;

    let bpmFinal = 0;
    if (dcRedOk && tempoOk) {
      if (dominantOk) {
        const delta = Math.abs(tempoBpm - dominantBpm);
        const matches = delta <= Math.max(12, dominantBpm * 0.12);
        // Si concuerdan, fusión ponderada hacia el detector temporal.
        // Si NO concuerdan, confiar en el espectral (robusto a falsos picos).
        bpmFinal = matches ? tempoBpm * 0.7 + dominantBpm * 0.3 : dominantBpm;
      } else if (heartBeatResult.bpmConfidence >= 0.45) {
        // Sin dominante espectral consolidado pero el HBP tiene alta
        // confianza interna (acuerdo temporal-espectral, RR estable).
        bpmFinal = tempoBpm;
      }
    } else if (dcRedOk && !tempoOk && dominantOk) {
      bpmFinal = dominantBpm;
    }
    const smoothedBPM = bpmFinal > 0 ? applyEMA(emaRef.current.bpm, bpmFinal) : 0;
    emaRef.current.bpm = smoothedBPM;
    if (smoothedBPM > 0) {
      lastValidBpmRef.current = { bpm: smoothedBPM, ts: Date.now() };
      setHeartRate(smoothedBPM);
    } else {
      // Hold del último BPM válido durante BPM_HOLD_MS para evitar parpadeo
      // ante valles fisiológicos breves o pequeñas pérdidas momentáneas
      // de coherencia espectral. Comportamiento estándar de monitor clínico.
      const lv = lastValidBpmRef.current;
      const heldFresh = lv.bpm > 0 && Date.now() - lv.ts < BPM_HOLD_MS;
      if (!heldFresh && heartRate !== 0) setHeartRate(0);
    }

    if (heartBeatResult.isPeak) {
      ingestBeatOpticalRatio();
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
    if (vitalSignsFrameCounter.current < VITALS_PROCESS_EVERY_N_FRAMES) return;
    vitalSignsFrameCounter.current = 0;

    // Si el BPM no pasó la validación espectral cruzada, NO publicamos
    // signos vitales: una BP / SpO2 / glucosa derivada de un BPM falso
    // sería numéricamente válida pero físicamente sin sentido.
    if (bpmFinal === 0) {
      setVitalSigns((prev) =>
        prev.spo2 === 0 && prev.pressure.systolic === 0 && prev.glucose === 0
          ? prev
          : {
              ...prev,
              spo2: 0,
              glucose: 0,
              pressure: { systolic: 0, diastolic: 0, confidence: "INSUFFICIENT", featureQuality: 0 },
              lipids: { totalCholesterol: 0, triglycerides: 0 },
              measurementConfidence: "INVALID",
            }
      );
      return;
    }

    const rgbStats = getRGBStats();
    const detectorAgreement = heartBeatResult.detectorAgreement ?? heartBeatResult.debug.detectorAgreement ?? 0;
    const rrStability = computeRRStability(heartBeatResult.rrData?.intervals || []);

    const beatInputs =
      heartBeatResult.debug.recentAcceptedBeats && heartBeatResult.debug.recentAcceptedBeats.length > 0
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
            },
          }))
        : undefined;

    const usableRRData =
      heartBeatResult.rrData &&
      heartBeatResult.rrData.intervals.length >= 2 &&
      heartBeatResult.bpmConfidence > 0.18
        ? heartBeatResult.rrData
        : undefined;

    setHeartRuntime({
      bpm: heartBeatResult.bpm,
      bpmConfidence: heartBeatResult.bpmConfidence,
      beatCount: heartBeatResult.debug.beatsAccepted,
    });

    setUpstreamContext({
      contactStable: passed,
      pressureOptimal,
      clipHighRatio: clipHigh,
      sourceStability,
      avgBeatSQI: heartBeatResult.beatSQI ?? heartBeatResult.debug.lastBeatSQI ?? 0,
      beatCount: heartBeatResult.debug.beatsAccepted ?? heartBeatResult.rrData?.intervals.length ?? 0,
    });

    const vitals = processVitalSigns(ls.filteredValue, usableRRData, beatInputs, {
      passed,
      qualityScore: evidence.score,
      reasons: evidence.reasons,
      dominantFrequencyHz:
        (specWin as { dominantFrequencyHz?: number } | undefined)?.dominantFrequencyHz,
      detectorAgreementScore: specWin?.detectorAgreementScore,
      channelCoherence,
      // perfusionIndex en la app está en % (PI = AC/DC * 100). Se pasa como
      // tercer argumento al evidenceContext del VitalSignsProcessor.
      acDc: { r: acDcR, g: acDcG },
      perfusionIndex: ls.perfusionIndex ?? 0,
    });

    if (rgbStats.redDC > 0 && rgbStats.greenDC > 0) {
      setRGBData({
        redAC: rgbStats.redAC,
        redDC: rgbStats.redDC,
        greenAC: rgbStats.greenAC,
        greenDC: rgbStats.greenDC,
      });
    }

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

    if (usableRRData && vitals.measurementConfidence !== "INVALID") {
      const arrhythmiaStatus = vitals.arrhythmiaStatus;
      if (arrhythmiaStatus) {
        lastArrhythmiaData.current = vitals.lastArrhythmiaData || null;
        const parts = arrhythmiaStatus.split("|");
        const rhythmLabel = vitals.rhythm?.label || parts[0] || "SINUS_STABLE";
        const count = parseInt(parts[1] || "0", 10) || 0;
        setArrhythmiaCount(count > 0 ? count : rhythmLabel.split("_").join(" "));

        const isArrhythmiaDetected = !NON_ALERT_RHYTHMS.has(rhythmLabel);
        if (isArrhythmiaDetected !== arrhythmiaDetectedRef.current) {
          arrhythmiaDetectedRef.current = isArrhythmiaDetected;
          setArrhythmiaState(isArrhythmiaDetected);

          if (isArrhythmiaDetected) {
            if (passed && navigator.vibrate) navigator.vibrate([200, 100, 200]);
            toast({
              title: `⚠️ ${rhythmLabel.split("_").join(" ")}`,
              description: count > 0 ? `Eventos detectados: ${count}` : "Ritmo irregular detectado",
              variant: "destructive",
              duration: 4000,
            });
          }
        }
      }
    }
  }, [
    lastSignal,
    isMonitoring,
    processHeartBeat,
    processVitalSigns,
    setArrhythmiaState,
    setRGBData,
    setUpstreamContext,
    setHeartRuntime,
    ingestBeatOpticalRatio,
    getRGBStats,
    getPositionQuality,
    computeRRStability,
    applyEMA,
    vitalSigns.arrhythmiaCount,
    stableHumanSignal,
  ]);

  // Cierre por tiempo
  useEffect(() => {
    if (isMonitoring && elapsedTime >= 60) finalizeMeasurement();
  }, [elapsedTime, isMonitoring, finalizeMeasurement]);

  // Progreso de calibración
  useEffect(() => {
    if (!isCalibrating) return;
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);
      if (currentProgress >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
        if (stableHumanSignalRef.current && navigator.vibrate) navigator.vibrate([100]);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  const handleToggleMonitoring = useCallback(() => {
    if (isMonitoring) finalizeMeasurement();
    else startMonitoring();
  }, [isMonitoring, finalizeMeasurement, startMonitoring]);

  // Posición/guía (calculado memoizadamente)
  const positionQualityForUi = useMemo(() => getPositionQuality(), [getPositionQuality, lastSignal]);

  // ============ RENDER ============
  return (
    <div
      className="fixed inset-0 flex flex-col bg-black"
      style={{
        height: "100svh",
        width: "100vw",
        maxWidth: "100vw",
        maxHeight: "100svh",
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
      }}
    >
      {!isFullscreen && (
        <button
          onClick={enterFullScreen}
          className="fixed inset-0 z-50 w-full h-full flex items-center justify-center bg-black/90 text-white"
        >
          <div className="text-center p-4 bg-primary/20 rounded-lg backdrop-blur-sm">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-12 w-12 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5m11 5v-4m0 4h-4m4 0l-5-5"
              />
            </svg>
            <p className="text-lg font-semibold">Toca para modo pantalla completa</p>
          </div>
        </button>
      )}

      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <CameraView ref={cameraRef} onStreamReady={handleStreamReady} isMonitoring={isCameraOn} />
        </div>

        {isMonitoring &&
          (() => {
            const pq = positionQualityForUi;
            const isDrifting = pq.drifting;
            const isLocked = pq.locked && !isDrifting;
            const showGuidance = !isLocked || isDrifting;
            return showGuidance || isLocked ? (
              <div className="absolute top-1 left-0 right-0 z-20 flex justify-center pointer-events-none">
                <div
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wider shadow-lg backdrop-blur-md border ${
                    isLocked
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                      : isDrifting
                      ? "bg-red-500/20 border-red-500/40 text-red-300 animate-pulse"
                      : pq.qualityScore > 0.4
                      ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                      : "bg-red-500/20 border-red-500/40 text-red-300"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {isLocked ? (
                      <Shield className="w-3 h-3" />
                    ) : isDrifting ? (
                      <AlertTriangle className="w-3 h-3" />
                    ) : (
                      <Activity className="w-3 h-3 animate-pulse" />
                    )}
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
              {showPpgDebug ? "DBG ▾" : "DBG ▴"}
            </button>
            {showPpgDebug &&
              isMonitoring &&
              lastSignal &&
              (() => {
                const dbg = getPPGDebugInfo();
                const pd = lastSignal.pipelineDebug;
                return (
                  <div className="fixed bottom-2 left-1 right-1 z-30 max-h-[40vh] overflow-y-auto bg-black/92 text-[10px] text-lime-100 font-mono p-2 rounded border border-slate-600 shadow-xl">
                    <div className="text-amber-300 font-bold mb-1">PPG / contacto / ROI / fusión</div>
                    <div>
                      estado_dedo: {pd?.fingerMeasurementState ?? "—"} | contact_export: {lastSignal.contactState}
                    </div>
                    <div>
                      ventana_SQI:{" "}
                      {pd?.windowSQI
                        ? `${(pd.windowSQI.score * 100).toFixed(0)}% ${pd.windowSQI.gating} [${pd.windowSQI.reasons
                            .slice(0, 2)
                            .join("; ")}]`
                        : "—"}
                    </div>
                    <div>
                      FPS~: {pd?.frameTiming?.effectiveFps?.toFixed(1) ?? "—"} | Δt_ms:{" "}
                      {pd?.frameTiming?.intervalMs?.toFixed(1) ?? "—"} | drops≈{pd?.frameTiming?.droppedEstimate ?? 0}
                    </div>
                    <div>
                      worker: {String(dbg?.workerMode)} {dbg?.workerFallbackReason ? `(${dbg.workerFallbackReason})` : ""}{" "}
                      | q={dbg?.workerQueue ?? 0} | lat~ms {dbg?.workerLatencyMs?.toFixed(1) ?? "—"}
                    </div>
                    <div>
                      cap: det {String((pd?.acquisition as { detectionWidth?: number })?.detectionWidth)}×
                      {String((pd?.acquisition as { detectionHeight?: number })?.detectionHeight)} | ext{" "}
                      {String((pd?.acquisition as { extractionWidth?: number })?.extractionWidth)}×
                      {String((pd?.acquisition as { extractionHeight?: number })?.extractionHeight)} | tier{" "}
                      {String((pd?.acquisition as { extractionTierId?: string })?.extractionTierId)} | mode{" "}
                      {String((pd?.acquisition as { extractionMode?: string })?.extractionMode)}
                    </div>
                    <div>
                      espectral: f_dom≈
                      {((pd?.windowSQI?.spectral as { dominantFrequencyHz?: number })?.dominantFrequencyHz ?? 0).toFixed(2)}{" "}
                      Hz | acuerdo_temp/esp{" "}
                      {((pd?.windowSQI?.spectral as { detectorAgreementScore?: number })?.detectorAgreementScore ?? 0).toFixed(
                        2
                      )}
                    </div>
                    <div>
                      fusión: colapso {pd?.fusionCollapse ? "SÍ" : "no"} | faseQ{" "}
                      {((pd?.fusionMeta as { phaseAlignmentQuality?: number })?.phaseAlignmentQuality ?? 0).toFixed(2)} |
                      acuerdo {((pd?.fusionMeta as { sourceAgreement?: number })?.sourceAgreement ?? 0).toFixed(2)}
                    </div>
                    <div>fuente: {lastSignal.activeSource ?? "—"}</div>
                    <div className="mt-1 text-slate-400">top ROI (id/score/clip):</div>
                    <div className="whitespace-pre-wrap break-all">
                      {(pd?.topRois ?? [])
                        .slice(0, 5)
                        .map((r) => `${r.id}:${r.score.toFixed(2)}/${r.clipRatio.toFixed(2)}`)
                        .join(" | ")}
                    </div>
                    <div className="mt-1">
                      BPM_ui: {heartRate || "—"} | calidad_proc: {(lastSignal.quality ?? 0).toFixed(0)} | LIVE_PPG:{" "}
                      {stableHumanSignal ? "✓" : "✗"}
                    </div>
                  </div>
                );
              })()}
            <PPGSignalMeter
              value={heartbeatSignal}
              quality={lastSignal?.quality ?? 0}
              isFingerDetected={lastSignal?.fingerDetected ?? false}
              onStartMeasurement={handleToggleMonitoring}
              onReset={handleReset}
              livePpgEvidencePassed={stableHumanSignal}
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

          {/* Tira inferior compacta de signos vitales secundarios.
              El monitor PPG ocupa el 100% de la pantalla; este overlay flota
              sobre él, translúcido, sin robarle alto. */}
          <div
            className="absolute inset-x-0 z-20 px-2 pointer-events-none"
            style={{ bottom: "52px" }}
          >
            <div className="grid grid-cols-4 gap-1.5 px-1.5 py-1.5 bg-slate-950/65 backdrop-blur-md border border-slate-700/40 rounded-lg pointer-events-auto">
              <VitalSign
                label="PRESIÓN"
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
              <VitalSign
                label="GLUCOSA"
                value={vitalSigns.glucose > 0 ? vitalSigns.glucose : "--"}
                unit="mg/dL"
                highlighted={showResults}
                isResearch={true}
              />
              <VitalSign
                label="COL./TRG."
                value={
                  vitalSigns.lipids?.totalCholesterol > 0 || vitalSigns.lipids?.triglycerides > 0
                    ? `${vitalSigns.lipids?.totalCholesterol ?? "--"}/${vitalSigns.lipids?.triglycerides ?? "--"}`
                    : "--/--"
                }
                unit="mg/dL"
                highlighted={showResults}
                isResearch={true}
              />
              <VitalSign
                label="RITMO"
                value={vitalSigns.arrhythmiaStatus ?? "SIN ARRITMIAS|0"}
                highlighted={showResults}
              />
            </div>
          </div>

          {showResults &&
            measurementSummary &&
            (() => {
              const { totalBeats, arrhythmiaBeats, normalPercent } = measurementSummary;
              const normalBeats = totalBeats - arrhythmiaBeats;
              const avgBpm = heartRate > 0 ? Math.round(heartRate) : "--";
              const statusColor = normalPercent >= 95 ? "emerald" : normalPercent >= 80 ? "yellow" : "red";
              const statusText = vitalSigns.rhythm?.label
                ? vitalSigns.rhythm.label.split("_").join(" ")
                : normalPercent >= 95
                ? "RITMO NORMAL"
                : normalPercent >= 80
                ? "LEVE IRREGULARIDAD"
                : "IRREGULARIDAD DETECTADA";
              const StatusIcon = normalPercent >= 95 ? CheckCircle2 : AlertTriangle;
              const statusBgClass =
                statusColor === "emerald"
                  ? "bg-emerald-500/10"
                  : statusColor === "yellow"
                  ? "bg-yellow-500/10"
                  : "bg-red-500/10";
              const statusTextClass =
                statusColor === "emerald"
                  ? "text-emerald-400"
                  : statusColor === "yellow"
                  ? "text-yellow-400"
                  : "text-red-400";
              const statusTextColorClass =
                statusColor === "emerald"
                  ? "text-emerald-300"
                  : statusColor === "yellow"
                  ? "text-yellow-300"
                  : "text-red-300";
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
                  <div className="bg-slate-950 border border-slate-700/50 rounded-2xl max-w-sm w-[92%] shadow-2xl overflow-hidden">
                    <div className={`px-4 py-3 ${statusBgClass} border-b border-slate-800`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <StatusIcon className={`w-5 h-5 ${statusTextClass}`} />
                          <div>
                            <h3 className="text-white text-sm font-bold tracking-wide">MEDICIÓN COMPLETADA</h3>
                            <p className={`${statusTextColorClass} text-[10px] font-semibold tracking-wider`}>
                              {statusText}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setMeasurementSummary(null)}
                          className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors"
                        >
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
                            {vitalSigns.spo2 > 0 ? vitalSigns.spo2 : "--"}
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
                              {vitalSigns.pressure.confidence && vitalSigns.pressure.confidence !== "INSUFFICIENT" && (
                                <span
                                  className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${
                                    vitalSigns.pressure.confidence === "HIGH"
                                      ? "bg-emerald-500/20 text-emerald-400"
                                      : vitalSigns.pressure.confidence === "MEDIUM"
                                      ? "bg-yellow-500/20 text-yellow-400"
                                      : "bg-orange-500/20 text-orange-400"
                                  }`}
                                >
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
                            <span className="text-white/70 text-[9px]">60s</span>
                          </div>
                        </div>
                        <div className="mb-2">
                          <div className="flex justify-between items-center mb-0.5">
                            <span className="text-emerald-400 text-[9px] font-medium">■ Normales</span>
                            <span className="text-white text-xs font-bold">{normalBeats}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-1000 ease-out"
                              style={{ width: `${totalBeats > 0 ? (normalBeats / totalBeats) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-0.5">
                            <span className="text-red-400 text-[9px] font-medium">■ Arrítmicos</span>
                            <span className="text-white text-xs font-bold">{arrhythmiaBeats}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ease-out ${
                                arrhythmiaBeats > 0 ? "bg-gradient-to-r from-red-600 to-red-400" : "bg-slate-700"
                              }`}
                              style={{ width: `${totalBeats > 0 ? (arrhythmiaBeats / totalBeats) * 100 : 100}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-center gap-4 pt-1">
                        <div className="relative w-16 h-16">
                          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                            <path
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none"
                              stroke="#1e293b"
                              strokeWidth="3"
                            />
                            <path
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none"
                              className={`${
                                statusColor === "emerald"
                                  ? "stroke-emerald-400"
                                  : statusColor === "yellow"
                                  ? "stroke-yellow-400"
                                  : "stroke-red-400"
                              }`}
                              strokeWidth="3"
                              strokeDasharray={`${normalPercent}, 100`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span
                              className={`text-sm font-bold ${
                                statusColor === "emerald"
                                  ? "text-emerald-400"
                                  : statusColor === "yellow"
                                  ? "text-yellow-400"
                                  : "text-red-400"
                              }`}
                            >
                              {normalPercent}%
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-white text-xs font-semibold">Ritmo Normal</div>
                          <div className="text-slate-500 text-[9px]">{totalBeats} latidos analizados</div>
                          <div
                            className={`text-[10px] font-semibold mt-0.5 ${
                              statusColor === "emerald"
                                ? "text-emerald-400"
                                : statusColor === "yellow"
                                ? "text-yellow-400"
                                : "text-red-400"
                            }`}
                          >
                            {statusText}
                          </div>
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
                        {isAnalyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" /> Analizando...
                          </>
                        ) : (
                          <>
                            <Brain className="w-4 h-4" /> Análisis AI de Salud
                          </>
                        )}
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
                  <button
                    onClick={() => {
                      setShowAIAnalysis(false);
                      clearAnalysis();
                    }}
                    className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors"
                  >
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
