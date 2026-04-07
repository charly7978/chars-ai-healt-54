import React, { useState, useRef, useEffect, useCallback } from "react";
import { Heart, AlertTriangle, Activity, X, Shield, Clock, CheckCircle2 } from "lucide-react";
import { playCompletionSound } from "@/utils/soundUtils";
import VitalSign from "@/components/VitalSign";
import CameraView, { CameraViewHandle } from "@/components/CameraView";
import { usePPGEngine } from "@/hooks/usePPGEngine";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import { useSaveMeasurement } from "@/hooks/useSaveMeasurement";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";
import BPCalibrationWizard from "@/components/BPCalibrationWizard";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  // ESTADOS PRINCIPALES
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0, glucose: 0, hemoglobin: 0,
    pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
    arrhythmiaCount: 0, arrhythmiaStatus: "SIN ARRITMIAS|0",
    lipids: { totalCholesterol: 0, triglycerides: 0 },
    isCalibrating: false, calibrationProgress: 0,
    lastArrhythmiaData: undefined, signalQuality: 0, measurementConfidence: 'INVALID'
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
  const [showCalibrationWizard, setShowCalibrationWizard] = useState(false);
  const [measurementSummary, setMeasurementSummary] = useState<{
    totalBeats: number; arrhythmiaBeats: number; normalPercent: number;
  } | null>(null);
  
  // REFERENCIAS
  const measurementTimerRef = useRef<number | null>(null);
  const totalBeatsRef = useRef(0);
  const arrhythmiaBeatsRef = useRef(0);
  const lastArrhythmiaCountForBeatsRef = useRef(0);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const cameraRef = useRef<CameraViewHandle>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameLoopRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  
  // NEW PPG ENGINE
  const {
    startEngine, stopEngine, processFrame: engineProcessFrame,
    measurementState,
    heartbeatSignalRef, isPeakRef, bpmRef, bpmConfidenceRef,
    qualityScoreRef, contactInstructionRef, semaphoreRef,
    warmupProgressRef, stableContactMsRef, activeSourceRef,
    motionScoreRef, perfusionRef, clippingRef, invalidReasonsRef,
    exportSession, exportCSV,
    signalExtractor, beatEngine,
  } = usePPGEngine();
  
  // VITAL SIGNS (kept for other measurements)
  const { 
    processSignal: processVitalSigns, setRGBData,
    reset: resetVitalSigns, fullReset: fullResetVitalSigns,
    calibrateBP, hasValidPressureEstimate, lastValidResults,
    startCalibration, forceCalibrationCompletion, getCalibrationProgress
  } = useVitalSignsProcessor();
  
  const { saveMeasurement } = useSaveMeasurement();
  const [isCalibrated, setIsCalibrated] = useState(false);

  // AUTO-LOAD CALIBRATION
  useEffect(() => {
    const loadSavedCalibration = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from("calibration_settings")
          .select("systolic_reference, diastolic_reference, is_active, status")
          .eq("user_id", user.id).eq("is_active", true).eq("status", "completed")
          .maybeSingle();
        if (data?.systolic_reference && data?.diastolic_reference) {
          calibrateBP(data.systolic_reference, data.diastolic_reference);
          setIsCalibrated(true);
        }
      } catch {}
    };
    loadSavedCalibration();
  }, [calibrateBP]);

  // CANVAS
  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 320;
      canvasRef.current.height = 240;
      ctxRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true, alpha: false });
    }
  }, []);

  // FULLSCREEN
  const enterFullScreen = async () => {
    if (isFullscreen) return;
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) await docEl.requestFullscreen();
      else if ((docEl as any).webkitRequestFullscreen) await (docEl as any).webkitRequestFullscreen();
      if (screen.orientation?.lock) await screen.orientation.lock('portrait').catch(() => {});
      setIsFullscreen(true);
    } catch {}
  };
  
  const exitFullScreen = () => {
    if (!isFullscreen) return;
    try {
      if (document.exitFullscreen) document.exitFullscreen();
      else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
      screen.orientation?.unlock();
      setIsFullscreen(false);
    } catch {}
  };

  useEffect(() => {
    const timer = setTimeout(() => enterFullScreen(), 1000);
    const handleFSChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFSChange);
    document.addEventListener('webkitfullscreenchange', handleFSChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFSChange);
      document.removeEventListener('webkitfullscreenchange', handleFSChange);
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

  // === FRAME CAPTURE LOOP ===
  const startFrameLoop = useCallback(() => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) { isProcessingRef.current = false; return; }

    const captureOneFrame = () => {
      if (!isProcessingRef.current) return;
      const video = cameraRef.current?.getVideoElement();
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        frameLoopRef.current = requestAnimationFrame(captureOneFrame);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        engineProcessFrame(imageData);
      } catch {}
      scheduleNext(video);
    };

    const scheduleNext = (video: HTMLVideoElement) => {
      if (!isProcessingRef.current) return;
      if ('requestVideoFrameCallback' in video) {
        (video as any).requestVideoFrameCallback(() => captureOneFrame());
      } else {
        frameLoopRef.current = requestAnimationFrame(captureOneFrame);
      }
    };
    captureOneFrame();
  }, [engineProcessFrame]);

  const stopFrameLoop = useCallback(() => {
    isProcessingRef.current = false;
    if (frameLoopRef.current) {
      cancelAnimationFrame(frameLoopRef.current);
      frameLoopRef.current = null;
    }
  }, []);

  // === SYNC ENGINE → UI (throttled via measurementState) ===
  useEffect(() => {
    if (!isMonitoring) return;

    // Update UI from engine refs
    const bpm = bpmRef.current;
    if (bpm > 0) setHeartRate(bpm);
    setHeartbeatSignal(heartbeatSignalRef.current);

    if (isPeakRef.current) {
      setBeatMarker(1);
      setTimeout(() => setBeatMarker(0), 300);
      totalBeatsRef.current++;
    }

    // Update RR intervals from beat engine
    const rr = beatEngine.current.getRRIntervals();
    if (rr.length > 0) setRRIntervals(rr.slice(-5));

    // Feed vital signs processor (throttled — only when we have data)
    const ext = signalExtractor.current;
    if (ext.greenDC > 0 && ext.greenAC > 0) {
      setRGBData({
        redAC: ext.redAC, redDC: ext.redDC,
        greenAC: ext.greenAC, greenDC: ext.greenDC,
      });
    }

    if (rr.length >= 3 && heartbeatSignalRef.current !== 0) {
      const vitals = processVitalSigns(heartbeatSignalRef.current, {
        intervals: rr, lastPeakTime: Date.now(),
      });
      if (vitals) {
        setVitalSigns(vitals);
        if (vitals.arrhythmiaStatus) {
          const parts = vitals.arrhythmiaStatus.split('|');
          setArrhythmiaCount(parts.length > 1 ? parts[1] : "0");

          const isArr = vitals.arrhythmiaStatus.includes("ARRITMIA DETECTADA");
          if (isArr !== arrhythmiaDetectedRef.current) {
            arrhythmiaDetectedRef.current = isArr;
            if (isArr) {
              arrhythmiaBeatsRef.current++;
              if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
              toast({ title: "⚠️ Arritmia detectada", description: `Latido irregular #${vitals.arrhythmiaCount}`, variant: "destructive", duration: 4000 });
            }
          }
        }
      }
    }
  }, [measurementState, isMonitoring]);

  // === START MONITORING ===
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
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));

    startEngine();
    startCalibration();
    setIsCameraOn(true);
    setIsMonitoring(true);

    if (measurementTimerRef.current) clearInterval(measurementTimerRef.current);
    measurementTimerRef.current = window.setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    setIsCalibrating(true);
    setTimeout(() => setIsCalibrating(false), 3000);
  }, [isMonitoring, startEngine, startCalibration, enterFullScreen]);

  // === STREAM READY ===
  const handleStreamReady = useCallback((stream: MediaStream) => {
    setCameraStream(stream);
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
  }, [startFrameLoop]);

  // === FINALIZE ===
  const finalizeMeasurement = useCallback(async () => {
    if (!isMonitoring) return;
    playCompletionSound();
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    
    stopFrameLoop();
    stopEngine();
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    if (isCalibrating) forceCalibrationCompletion();
    const savedResults = resetVitalSigns();

    if (savedResults || vitalSigns.spo2 > 0) {
      const dataToSave = savedResults || vitalSigns;
      await saveMeasurement({ heartRate, vitalSigns: dataToSave, signalQuality: qualityScoreRef.current });
    }

    setIsCameraOn(false);
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setIsMonitoring(false);
    setIsCalibrating(false);
    if (savedResults) setVitalSigns(savedResults);
    setShowResults(true);

    setMeasurementSummary({
      totalBeats: totalBeatsRef.current,
      arrhythmiaBeats: arrhythmiaBeatsRef.current,
      normalPercent: totalBeatsRef.current > 0
        ? Math.round(((totalBeatsRef.current - arrhythmiaBeatsRef.current) / totalBeatsRef.current) * 100) : 100
    });
    setElapsedTime(0);
    setCalibrationProgress(0);
  }, [isMonitoring, isCalibrating, cameraStream, stopFrameLoop, stopEngine, forceCalibrationCompletion, resetVitalSigns, saveMeasurement, heartRate, vitalSigns]);

  // === RESET ===
  const handleReset = useCallback(() => {
    stopFrameLoop();
    stopEngine();
    if (measurementTimerRef.current) { clearInterval(measurementTimerRef.current); measurementTimerRef.current = null; }
    fullResetVitalSigns();
    setIsCameraOn(false);
    if (cameraStream) { cameraStream.getTracks().forEach(track => track.stop()); setCameraStream(null); }
    setIsMonitoring(false); setShowResults(false); setMeasurementSummary(null);
    setIsCalibrating(false); setElapsedTime(0); setHeartRate(0);
    totalBeatsRef.current = 0; arrhythmiaBeatsRef.current = 0;
    setHeartbeatSignal(0); setBeatMarker(0); setRRIntervals([]);
    setVitalSigns({
      spo2: 0, glucose: 0, hemoglobin: 0,
      pressure: { systolic: 0, diastolic: 0, confidence: 'INSUFFICIENT' as const, featureQuality: 0 },
      arrhythmiaCount: 0, arrhythmiaStatus: "SIN ARRITMIAS|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false, calibrationProgress: 0,
      lastArrhythmiaData: undefined, signalQuality: 0, measurementConfidence: 'INVALID'
    });
    setArrhythmiaCount("--");
    setCalibrationProgress(0);
    arrhythmiaDetectedRef.current = false;
  }, [cameraStream, stopFrameLoop, stopEngine, fullResetVitalSigns]);

  // AUTO-FINALIZE at 60s
  useEffect(() => {
    if (isMonitoring && elapsedTime >= 60) finalizeMeasurement();
  }, [elapsedTime, isMonitoring, finalizeMeasurement]);

  // CALIBRATION PROGRESS
  useEffect(() => {
    if (!isCalibrating) return;
    const interval = setInterval(() => {
      const p = getCalibrationProgress();
      setCalibrationProgress(p);
      if (p >= 100) { clearInterval(interval); setIsCalibrating(false); if (navigator.vibrate) navigator.vibrate([100]); }
    }, 500);
    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  const handleToggleMonitoring = () => {
    if (isMonitoring) finalizeMeasurement();
    else startMonitoring();
  };

  // Export handlers
  const handleExportJSON = useCallback(() => {
    const data = exportSession();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ppg_session_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [exportSession]);

  const handleExportCSV = useCallback(() => {
    const csv = exportCSV();
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ppg_session_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [exportCSV]);

  // Semaphore color
  const semColor = measurementState.semaphore === 'green' ? 'bg-emerald-500'
    : measurementState.semaphore === 'yellow' ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="fixed inset-0 flex flex-col bg-black" style={{ 
      height: '100svh', width: '100vw', maxWidth: '100vw', maxHeight: '100svh',
      overflow: 'hidden', touchAction: 'none', userSelect: 'none',
      WebkitTouchCallout: 'none', WebkitUserSelect: 'none'
    }}>
      {!isFullscreen && (
        <button onClick={enterFullScreen}
          className="fixed inset-0 z-50 w-full h-full flex items-center justify-center bg-black/90 text-white">
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

        <div className="relative z-10 h-full">
          {/* SEMAPHORE + STATE BAR */}
          {isMonitoring && (
            <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-1.5 bg-black/70 backdrop-blur-sm">
              <div className={`w-3 h-3 rounded-full ${semColor} animate-pulse`} />
              <span className="text-xs text-white/90 font-mono flex-1 truncate">
                {measurementState.instruction}
              </span>
              {measurementState.phase === 'CONTACT_OK_WARMING_UP' || measurementState.phase === 'STABILIZING_CONTACT' ? (
                <span className="text-[10px] text-yellow-300 font-mono">
                  {(warmupProgressRef.current * 100).toFixed(0)}%
                </span>
              ) : null}
              <span className="text-[10px] text-white/50 font-mono">{elapsedTime}s</span>
            </div>
          )}

          <div className="flex-1 h-full">
            <PPGSignalMeter 
              value={heartbeatSignal}
              quality={qualityScoreRef.current}
              isFingerDetected={measurementState.contactState !== 'SEARCHING_FINGER' && measurementState.contactState !== 'NO_CAMERA'}
              onStartMeasurement={handleToggleMonitoring}
              onReset={handleReset}
              onOpenCalibration={() => setShowCalibrationWizard(true)}
              isMonitoring={isMonitoring}
              isCalibrated={isCalibrated}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
              diagnosticMessage={measurementState.instruction}
              isPeak={beatMarker === 1}
              bpm={heartRate}
              spo2={vitalSigns.spo2}
              rrIntervals={rrIntervals}
            />
          </div>

          {/* VITAL SIGNS GRID */}
          <div className="absolute inset-x-0 top-[55%] bottom-[60px] bg-black/10 px-4 py-6">
            <div className="grid grid-cols-3 gap-4 place-items-center">
              <VitalSign label="FRECUENCIA CARDÍACA" value={heartRate > 0 ? Math.round(heartRate) : "--"} unit="BPM" highlighted={showResults} />
              <VitalSign label="SPO2" value={vitalSigns.spo2 > 0 ? vitalSigns.spo2 : "--"} unit="%" highlighted={showResults} />
              <VitalSign label="PRESIÓN ARTERIAL"
                value={vitalSigns.pressure?.systolic > 0 ? `${vitalSigns.pressure.systolic}/${vitalSigns.pressure.diastolic}` : "--/--"}
                unit="mmHg" highlighted={showResults}
                confidenceLevel={vitalSigns.pressure?.confidence} featureQuality={vitalSigns.pressure?.featureQuality} />
              <VitalSign label="HEMOGLOBINA (EST.)" value={vitalSigns.hemoglobin > 0 ? vitalSigns.hemoglobin : "--"} unit="g/dL" highlighted={showResults} />
              <VitalSign label="GLUCOSA (EST.)" value={vitalSigns.glucose > 0 ? vitalSigns.glucose : "--"} unit="mg/dL" highlighted={showResults} />
              <VitalSign label="COLEST./TRIGL. (EST.)"
                value={vitalSigns.lipids?.totalCholesterol > 0 || vitalSigns.lipids?.triglycerides > 0
                  ? `${vitalSigns.lipids?.totalCholesterol || "--"}/${vitalSigns.lipids?.triglycerides || "--"}` : "--/--"}
                unit="mg/dL" highlighted={showResults} />
            </div>
          </div>

          {/* RESULTS SUMMARY */}
          {showResults && measurementSummary && (() => {
            const { totalBeats, arrhythmiaBeats, normalPercent } = measurementSummary;
            const normalBeats = totalBeats - arrhythmiaBeats;
            const avgBpm = heartRate > 0 ? Math.round(heartRate) : '--';
            const statusColor = normalPercent >= 95 ? 'emerald' : normalPercent >= 80 ? 'yellow' : 'red';
            const statusText = normalPercent >= 95 ? 'RITMO NORMAL' : normalPercent >= 80 ? 'LEVE IRREGULARIDAD' : 'IRREGULARIDAD DETECTADA';
            const StatusIcon = normalPercent >= 95 ? CheckCircle2 : AlertTriangle;
            
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
                <div className="bg-slate-950 border border-slate-700/50 rounded-2xl max-w-sm w-[92%] shadow-2xl overflow-hidden">
                  <div className={`px-4 py-3 bg-${statusColor}-500/10 border-b border-slate-800`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusIcon className={`w-5 h-5 text-${statusColor}-400`} />
                        <div>
                          <h3 className="text-white text-sm font-bold tracking-wide">MEDICIÓN COMPLETADA</h3>
                          <p className={`text-${statusColor}-400 text-[10px] font-semibold tracking-wider`}>{statusText}</p>
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
                          {vitalSigns.spo2 > 0 ? vitalSigns.spo2 : '--'}<span className="text-sm text-slate-400">%</span>
                        </div>
                        <div className="text-slate-500 text-[9px] mt-1 font-medium">SpO₂</div>
                      </div>
                    </div>
                    {vitalSigns.pressure?.systolic > 0 && (
                      <div className="bg-slate-900/80 rounded-xl p-3 border border-slate-800/50 flex items-center gap-3">
                        <Shield className="w-5 h-5 text-blue-400" />
                        <div className="flex-1">
                          <div className="text-slate-500 text-[9px] font-medium">PRESIÓN ARTERIAL</div>
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
                          <span className="text-slate-500 text-[9px]">60s</span>
                        </div>
                      </div>
                      <div className="mb-2">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-emerald-400 text-[9px] font-medium">■ Normales</span>
                          <span className="text-white text-xs font-bold">{normalBeats}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-1000"
                            style={{ width: `${totalBeats > 0 ? (normalBeats / totalBeats) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-red-400 text-[9px] font-medium">■ Arrítmicos</span>
                          <span className="text-white text-xs font-bold">{arrhythmiaBeats}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-1000 ${arrhythmiaBeats > 0 ? 'bg-gradient-to-r from-red-600 to-red-400' : 'bg-slate-700'}`}
                            style={{ width: `${totalBeats > 0 ? (arrhythmiaBeats / totalBeats) * 100 : 100}%` }} />
                        </div>
                      </div>
                    </div>
                    {/* EXPORT BUTTONS */}
                    <div className="flex gap-2 pt-1">
                      <button onClick={handleExportJSON} className="flex-1 text-[9px] py-1.5 rounded bg-slate-800 text-slate-300 font-mono hover:bg-slate-700">
                        EXPORT JSON
                      </button>
                      <button onClick={handleExportCSV} className="flex-1 text-[9px] py-1.5 rounded bg-slate-800 text-slate-300 font-mono hover:bg-slate-700">
                        EXPORT CSV
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      <BPCalibrationWizard
        isOpen={showCalibrationWizard}
        onClose={() => setShowCalibrationWizard(false)}
        onCalibrate={(sys, dia) => {
          if (!hasValidPressureEstimate() && !(vitalSigns.pressure?.systolic > 0)) return false;
          calibrateBP(sys, dia);
          setIsCalibrated(true);
          return true;
        }}
      />
    </div>
  );
};

export default Index;
