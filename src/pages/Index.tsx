import React, { useState, useRef, useEffect } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import CameraPreview from "@/components/CameraPreview";
import SignalDiagnostics from "@/components/SignalDiagnostics";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  // ESTADO ÚNICO Y DEFINITIVO
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [signalQuality, setSignalQuality] = useState(0);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: Number.NaN as unknown as number,
    glucose: 0,
    hemoglobin: 0,
    pressure: { systolic: 0, diastolic: 0 },
    arrhythmiaCount: 0,
    arrhythmiaStatus: "SIN ARRITMIAS|0",
    lipids: { totalCholesterol: 0, triglycerides: 0 },
    isCalibrating: false,
    calibrationProgress: 0,
    lastArrhythmiaData: undefined
  });
  const [heartRate, setHeartRate] = useState(0);
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [beatMarker, setBeatMarker] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  
  // REFERENCIAS
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  
  // CONTROL DE ESTADO
  const systemState = useRef<'IDLE' | 'STARTING' | 'ACTIVE' | 'STOPPING' | 'CALIBRATING'>('IDLE');
  const sessionIdRef = useRef<string>("");
  const initializationLock = useRef<boolean>(false);
  
  // Referencias para frame loop
  const frameLoopIdRef = useRef<number | null>(null);
  const frameLoopActiveRef = useRef<boolean>(false);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  
  // HOOKS - Sin MultiChannel
  const { 
    startProcessing, 
    stopProcessing, 
    lastSignal, 
    processFrame, 
    isProcessing, 
    framesProcessed,
    debugInfo: signalDebugInfo
  } = useSignalProcessor();
  
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState,
    reset: resetHeartBeat,
    debugInfo: heartDebugInfo
  } = useHeartBeatProcessor();
  
  const { 
    processSignal: processVitalSigns, 
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    lastValidResults,
    startCalibration,
    forceCalibrationCompletion,
    getCalibrationProgress
  } = useVitalSignsProcessor();

  // INICIALIZACIÓN ÚNICA
  useEffect(() => {
    if (initializationLock.current) return;
    
    initializationLock.current = true;
    const t = Date.now().toString(36);
    const c1 = (performance.now() | 0).toString(36);
    sessionIdRef.current = `main_${t}_${c1}`;
    
    return () => {
      frameLoopActiveRef.current = false;
      if (frameLoopIdRef.current) {
        cancelAnimationFrame(frameLoopIdRef.current);
        frameLoopIdRef.current = null;
      }
      initializationLock.current = false;
    };
  }, []);

  // PANTALLA COMPLETA
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
    } catch (err) {}
  };

  useEffect(() => {
    const timer = setTimeout(() => enterFullScreen(), 1000);
    
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement
      ));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      exitFullScreen();
    };
  }, []);

  // PREVENIR SCROLL
  useEffect(() => {
    const preventScroll = (e: Event) => e.preventDefault();
    const options = { passive: false };
    
    document.body.addEventListener('touchmove', preventScroll, options);
    document.body.addEventListener('scroll', preventScroll, options);

    return () => {
      document.body.removeEventListener('touchmove', preventScroll);
      document.body.removeEventListener('scroll', preventScroll);
    };
  }, []);

  // SINCRONIZACIÓN DE RESULTADOS
  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
  }, [lastValidResults, isMonitoring]);

  // INICIO
  const startMonitoring = () => {
    if (systemState.current !== 'IDLE') return;
    
    systemState.current = 'STARTING';
    
    if (navigator.vibrate) {
      navigator.vibrate([200]);
    }
    
    enterFullScreen();
    setIsMonitoring(true);
    setIsCameraOn(true);
    setShowResults(false);
    
    startProcessing();
    
    setElapsedTime(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    startAutoCalibration();
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
    }
    
    measurementTimerRef.current = window.setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        if (newTime >= 60) {
          finalizeMeasurement();
          return 60;
        }
        return newTime;
      });
    }, 1000);
    
    systemState.current = 'ACTIVE';
  };

  const startAutoCalibration = () => {
    if (isCalibrating || systemState.current === 'CALIBRATING') return;
    
    systemState.current = 'CALIBRATING';
    setIsCalibrating(true);
    startCalibration();
    
    setTimeout(() => {
      if (systemState.current === 'CALIBRATING') {
        systemState.current = 'ACTIVE';
      }
    }, 3000);
  };

  const finalizeMeasurement = () => {
    if (systemState.current === 'STOPPING' || systemState.current === 'IDLE') {
      return;
    }
    
    systemState.current = 'STOPPING';
    
    frameLoopActiveRef.current = false;
    if (frameLoopIdRef.current) {
      cancelAnimationFrame(frameLoopIdRef.current);
      frameLoopIdRef.current = null;
    }
    
    if (isCalibrating) {
      forceCalibrationCompletion();
    }
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setIsCalibrating(false);
    stopProcessing();
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    const savedResults = resetVitalSigns();
    if (savedResults) {
      setVitalSigns(savedResults);
      setShowResults(true);
    }
    
    setElapsedTime(0);
    setSignalQuality(0);
    setCalibrationProgress(0);
    
    systemState.current = 'IDLE';
  };

  const handleReset = () => {
    systemState.current = 'STOPPING';
    
    frameLoopActiveRef.current = false;
    if (frameLoopIdRef.current) {
      cancelAnimationFrame(frameLoopIdRef.current);
      frameLoopIdRef.current = null;
    }
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setShowResults(false);
    setIsCalibrating(false);
    stopProcessing();
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    fullResetVitalSigns();
    resetHeartBeat();
    
    if (tempCtxRef.current && tempCanvasRef.current) {
      tempCtxRef.current.clearRect(0, 0, tempCanvasRef.current.width, tempCanvasRef.current.height);
    }
    
    setElapsedTime(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setRRIntervals([]);
    setVitalSigns({ 
      spo2: Number.NaN as unknown as number,
      glucose: 0,
      hemoglobin: 0,
      pressure: { systolic: 0, diastolic: 0 },
      arrhythmiaCount: 0,
      arrhythmiaStatus: "SIN ARRITMIAS|0",
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      isCalibrating: false,
      calibrationProgress: 0,
      lastArrhythmiaData: undefined
    });
    setArrhythmiaCount("--");
    setSignalQuality(0);
    lastArrhythmiaData.current = null;
    setCalibrationProgress(0);
    arrhythmiaDetectedRef.current = false;
    
    systemState.current = 'IDLE';
  };

  // MANEJO DEL STREAM
  const handleStreamReady = (stream: MediaStream) => {
    setCameraStream(stream);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    if (frameLoopActiveRef.current) return;
    
    const videoTrack = stream.getVideoTracks()[0];
    
    if (videoTrack?.getCapabilities?.()?.torch) {
      videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      }).catch(() => {});
    }
    
    if (!tempCanvasRef.current) {
      tempCanvasRef.current = document.createElement('canvas');
      tempCtxRef.current = tempCanvasRef.current.getContext('2d', {willReadFrequently: true});
    }
    
    const tempCanvas = tempCanvasRef.current;
    const tempCtx = tempCtxRef.current;
    if (!tempCtx) return;
    
    const videoElement = document.querySelector('video') as HTMLVideoElement;
    if (!videoElement) return;
    
    let lastProcessTime = 0;
    const targetFrameInterval = 1000/30;
    
    frameLoopActiveRef.current = true;
    
    const processImage = () => {
      if (!frameLoopActiveRef.current) return;
      
      if (!isMonitoring || systemState.current !== 'ACTIVE' || !videoElement) {
        frameLoopActiveRef.current = false;
        return;
      }
      
      const now = Date.now();
      const timeSinceLastProcess = now - lastProcessTime;
      
      if (timeSinceLastProcess >= targetFrameInterval) {
        try {
          if (videoElement.readyState >= 2) {
            const targetWidth = Math.min(320, videoElement.videoWidth || 320);
            const targetHeight = Math.min(240, videoElement.videoHeight || 240);
            
            tempCanvas.width = targetWidth;
            tempCanvas.height = targetHeight;
            
            tempCtx.drawImage(
              videoElement, 
              0, 0, videoElement.videoWidth, videoElement.videoHeight,
              0, 0, targetWidth, targetHeight
            );
            
            const imageData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
            processFrame(imageData);
            
            lastProcessTime = now;
          }
        } catch (error) {}
      }
      
      if (frameLoopActiveRef.current && isMonitoring && systemState.current === 'ACTIVE') {
        frameLoopIdRef.current = requestAnimationFrame(processImage);
      } else {
        frameLoopActiveRef.current = false;
      }
    };

    frameLoopIdRef.current = requestAnimationFrame(processImage);
  };

  // PROCESAMIENTO DE SEÑALES - SIMPLIFICADO sin MultiChannel
  const vitalSignsFrameCounter = useRef<number>(0);
  const VITALS_PROCESS_EVERY_N_FRAMES = 5; // Procesar cada 5 frames (6 veces/segundo)
  
  useEffect(() => {
    if (!lastSignal) return;

    setSignalQuality(lastSignal.quality);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    const qualityFactor = lastSignal.fingerDetected ? 1 : 0.7;
    const signalValue = lastSignal.filteredValue * qualityFactor;

    // PROCESAMIENTO DE LATIDOS
    const heartBeatResult = processHeartBeat(
      signalValue,
      lastSignal.fingerDetected, 
      lastSignal.timestamp
    );
    
    setHeartRate(heartBeatResult.bpm);
    setHeartbeatSignal(signalValue);
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    
    // THROTTLE del procesamiento de signos vitales
    vitalSignsFrameCounter.current++;
    
    if (vitalSignsFrameCounter.current >= VITALS_PROCESS_EVERY_N_FRAMES) {
      vitalSignsFrameCounter.current = 0;
      
      // Procesamiento directo sin MultiChannel
      const vitals = processVitalSigns(lastSignal.filteredValue, heartBeatResult.rrData);
        
      if (vitals) {
        setVitalSigns(vitals);
        
        if (vitals.lastArrhythmiaData) {
          lastArrhythmiaData.current = vitals.lastArrhythmiaData;
          const [status, count] = vitals.arrhythmiaStatus.split('|');
          setArrhythmiaCount(count || "0");
          
          const isArrhythmiaDetected = status === "ARRITMIA DETECTADA";
          if (isArrhythmiaDetected !== arrhythmiaDetectedRef.current) {
            arrhythmiaDetectedRef.current = isArrhythmiaDetected;
            setArrhythmiaState(isArrhythmiaDetected);
            
            if (isArrhythmiaDetected) {
              toast({ 
                title: "¡Arritmia detectada!", 
                description: "Latido irregular identificado.", 
                variant: "destructive", 
                duration: 3000 
              });
            }
          }
        }
      }
    }
  }, [lastSignal, isMonitoring, processHeartBeat, processVitalSigns, setArrhythmiaState]);

  // CONTROL DE CALIBRACIÓN
  useEffect(() => {
    if (!isCalibrating) return;
    
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
        
        if (navigator.vibrate) {
          navigator.vibrate([100]);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      startMonitoring();
    }
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
      {/* OVERLAY PANTALLA COMPLETA */}
      {!isFullscreen && (
        <button 
          onClick={enterFullScreen}
          className="fixed inset-0 z-50 w-full h-full flex items-center justify-center bg-black/90 text-white"
        >
          <div className="text-center p-4 bg-primary/20 rounded-lg backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
            <p className="text-lg font-semibold">Toca para modo pantalla completa</p>
          </div>
        </button>
      )}

      <div className="flex-1 relative">
        {/* PANEL DE DIAGNÓSTICO VISUAL */}
        {isMonitoring && (
          <SignalDiagnostics
            rawValue={lastSignal?.rawValue || 0}
            filteredValue={lastSignal?.filteredValue || 0}
            quality={signalQuality}
            fingerDetected={lastSignal?.fingerDetected || false}
            bpm={heartRate}
            pulsatility={lastSignal?.diagnostics?.pulsatilityValue || 0}
          />
        )}
        
        {/* VENTANA DE PREVISUALIZACIÓN DE CÁMARA */}
        <CameraPreview 
          stream={cameraStream}
          isFingerDetected={lastSignal?.fingerDetected || false}
          signalQuality={signalQuality}
          isVisible={isCameraOn}
        />

        <div className="absolute inset-0">
          <CameraView 
            onStreamReady={handleStreamReady}
            isMonitoring={isCameraOn}
            isFingerDetected={lastSignal?.fingerDetected}
            signalQuality={signalQuality}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* HEADER DE ESTADO */}
          <div className="px-4 py-2 flex justify-around items-center bg-black/20">
            <div className="text-white text-lg">
              Calidad: {signalQuality}
            </div>
            <div className="text-white text-lg">
              {lastSignal?.fingerDetected ? "Huella Detectada" : "Huella No Detectada"}
            </div>
            <div className="text-white text-lg">
              Estado: {systemState.current}
            </div>
          </div>

          {/* PANEL DE DEBUG */}
          <div className="px-4 py-1 flex justify-around items-center bg-black/10 text-white text-sm">
            <div>Procesando: {isProcessing ? 'Sí' : 'No'}</div>
            <div>Frames: {framesProcessed}</div>
            <div>Calibrando: {isCalibrating ? 'Sí' : 'No'}</div>
          </div>

          <div className="flex-1">
            <PPGSignalMeter 
              value={beatMarker}
              quality={lastSignal?.quality || 0}
              isFingerDetected={lastSignal?.fingerDetected || false}
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
              diagnosticMessage={lastSignal?.diagnostics?.message}
            />
          </div>

          {/* DISPLAYS DE SIGNOS VITALES */}
          <div className="absolute inset-x-0 top-[55%] bottom-[60px] bg-black/10 px-4 py-6">
            <div className="grid grid-cols-3 gap-4 place-items-center">
              <VitalSign 
                label="FRECUENCIA CARDÍACA"
                value={heartRate || "--"}
                unit="BPM"
                highlighted={showResults}
              />
              <VitalSign 
                label="SPO2"
                value={vitalSigns.spo2 || "--"}
                unit="%"
                highlighted={showResults}
              />
              <VitalSign 
                label="PRESIÓN ARTERIAL"
                value={vitalSigns.pressure ? `${vitalSigns.pressure.systolic}/${vitalSigns.pressure.diastolic}` : "--/--"}
                unit="mmHg"
                highlighted={showResults}
              />
              <VitalSign 
                label="HEMOGLOBINA"
                value={vitalSigns.hemoglobin || "--"}
                unit="g/dL"
                highlighted={showResults}
              />
              <VitalSign 
                label="GLUCOSA"
                value={vitalSigns.glucose || "--"}
                unit="mg/dL"
                highlighted={showResults}
              />
              <VitalSign 
                label="COLESTEROL/TRIGL."
                value={`${vitalSigns.lipids?.totalCholesterol || "--"}/${vitalSigns.lipids?.triglycerides || "--"}`}
                unit="mg/dL"
                highlighted={showResults}
              />
            </div>
          </div>

          {/* BOTONERA */}
          <div className="absolute inset-x-0 bottom-4 flex gap-4 px-4">
            <div className="w-1/2">
              <MonitorButton 
                isMonitoring={isMonitoring} 
                onToggle={handleToggleMonitoring} 
                variant="monitor"
              />
            </div>
            <div className="w-1/2">
              <MonitorButton 
                isMonitoring={isMonitoring} 
                onToggle={handleReset} 
                variant="reset"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
