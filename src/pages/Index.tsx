import React, { useState, useRef, useEffect } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import CameraPreview from "@/components/CameraPreview";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import { useMultiChannelOptimizer } from "@/hooks/useMultiChannelOptimizer";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  // ESTADO ÚNICO Y DEFINITIVO - CERO DUPLICIDADES
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
  
  // REFERENCIAS ÚNICAS - CONTROL ABSOLUTO DE INSTANCIAS
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  
  // CONTROL ÚNICO DE ESTADO - EVITA INICIALIZACIONES PARALELAS ABSOLUTAMENTE
  const systemState = useRef<'IDLE' | 'STARTING' | 'ACTIVE' | 'STOPPING' | 'CALIBRATING'>('IDLE');
  const sessionIdRef = useRef<string>("");
  const initializationLock = useRef<boolean>(false);
  
  // HOOKS ÚNICOS - UNA SOLA INSTANCIA GARANTIZADA
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
    processChannels: processVitalChannels,
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    lastValidResults,
    startCalibration,
    forceCalibrationCompletion,
    getCalibrationProgress
  } = useVitalSignsProcessor();

  // Optimizer multicanal (uso pasivo; se alimenta desde lastSignal)
  const { pushRawSample, compute, pushFeedback, reset: resetOptimizer } = useMultiChannelOptimizer();

  // INICIALIZACIÓN ÚNICA CON BLOQUEO ABSOLUTO
  useEffect(() => {
    if (initializationLock.current) return;
    
    initializationLock.current = true;
    // Generar ID determinista basado en tiempo y contadores (sin aleatoriedad)
    const t = Date.now().toString(36);
    const c1 = (performance.now() | 0).toString(36);
    sessionIdRef.current = `main_${t}_${c1}`;
    
    console.log(`🚀 INICIALIZACIÓN ÚNICA GARANTIZADA: ${sessionIdRef.current}`);
    console.log(`📊 Debug Info - Signal: ${JSON.stringify(signalDebugInfo)}, Heart: ${JSON.stringify(heartDebugInfo)}`);
    
    return () => {
      console.log(`🚀 DESTRUCCIÓN CONTROLADA: ${sessionIdRef.current}`);
      initializationLock.current = false;
    };
  }, []);

  // PANTALLA COMPLETA ÚNICA
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
      console.log(`📱 Pantalla completa activada ÚNICA - ${sessionIdRef.current}`);
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
    } catch (err) {
      console.log('Error saliendo de pantalla completa:', err);
    }
  };

  // INICIALIZACIÓN AUTOMÁTICA ÚNICA
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

  // SINCRONIZACIÓN ÚNICA DE RESULTADOS
  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
      console.log(`✅ Resultados ÚNICOS sincronizados - ${sessionIdRef.current}`, lastValidResults);
    }
  }, [lastValidResults, isMonitoring]);

  // FUNCIÓN ÚNICA DE INICIO - BLOQUEO TOTAL DE DUPLICIDADES
  const startMonitoring = () => {
    // BLOQUEO ABSOLUTO DE MÚLTIPLES INICIALIZACIONES
    if (systemState.current !== 'IDLE') {
      console.warn(`⚠️ INICIO BLOQUEADO - Estado: ${systemState.current} - ${sessionIdRef.current}`);
      return;
    }
    
    systemState.current = 'STARTING';
    console.log(`🎬 INICIO ÚNICO DEFINITIVO - ${sessionIdRef.current}`);
    
    // UN SOLO BEEP - NUNCA MÁS
    if (navigator.vibrate) {
      navigator.vibrate([200]);
    }
    
    enterFullScreen();
    setIsMonitoring(true);
    setIsCameraOn(true);
    setShowResults(false);
    
    // PROCESAMIENTO ÚNICO
    startProcessing();
    
    // RESET ÚNICO
    setElapsedTime(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    // CALIBRACIÓN ÚNICA
    console.log(`🔧 Calibración ÚNICA iniciada - ${sessionIdRef.current}`);
    startAutoCalibration();
    
    // TEMPORIZADOR ÚNICO
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
    }
    
    measurementTimerRef.current = window.setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        if (newTime >= 30) {
          finalizeMeasurement();
          return 30;
        }
        return newTime;
      });
    }, 1000);
    
    systemState.current = 'ACTIVE';
    console.log(`✅ SISTEMA ÚNICO ACTIVO - ${sessionIdRef.current}`);
  };

  // CALIBRACIÓN ÚNICA
  const startAutoCalibration = () => {
    if (isCalibrating || systemState.current === 'CALIBRATING') return;
    
    systemState.current = 'CALIBRATING';
    console.log(`🎯 Calibración ÚNICA iniciada - ${sessionIdRef.current}`);
    setIsCalibrating(true);
    startCalibration();
    
    // Volver a ACTIVE después de calibración
    setTimeout(() => {
      if (systemState.current === 'CALIBRATING') {
        systemState.current = 'ACTIVE';
      }
    }, 3000);
  };

  // FINALIZACIÓN ÚNICA
  const finalizeMeasurement = () => {
    if (systemState.current === 'STOPPING' || systemState.current === 'IDLE') {
      return;
    }
    
    systemState.current = 'STOPPING';
    console.log(`🏁 FINALIZACIÓN ÚNICA - ${sessionIdRef.current}`);
    
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
    console.log(`✅ FINALIZACIÓN COMPLETADA - ${sessionIdRef.current}`);
  };

  const handleReset = () => {
    systemState.current = 'STOPPING';
    console.log(`🔄 RESET ÚNICO TOTAL - ${sessionIdRef.current}`);
    
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
    
    // RESET TOTAL DE ESTADOS
    setElapsedTime(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
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
    console.log(`✅ RESET TOTAL COMPLETADO - ${sessionIdRef.current}`);
  };

  // MANEJO ÚNICO DEL STREAM
  const handleStreamReady = (stream: MediaStream) => {
    // Guardar stream para previsualización
    setCameraStream(stream);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    console.log(`📹 Stream ÚNICO listo - ${sessionIdRef.current}`);
    
    const videoTrack = stream.getVideoTracks()[0];
    
    // LINTERNA ÚNICA
    if (videoTrack.getCapabilities()?.torch) {
      videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      }).catch(err => console.error("Error linterna:", err));
    }
    
    // PROCESAMIENTO ÚNICO DE FRAMES
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', {willReadFrequently: true});
    if (!tempCtx) return;
    
    let lastProcessTime = 0;
    const targetFrameInterval = 1000/30; // 30 FPS EXACTOS
    
    const videoElement = document.querySelector('video') as HTMLVideoElement;
    if (!videoElement) return;
    
    const processImage = async () => {
      if (!isMonitoring || systemState.current !== 'ACTIVE' || !videoElement) return;
      
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
        } catch (error) {
          console.error("Error procesando frame:", error);
        }
      }
      
      if (isMonitoring && systemState.current === 'ACTIVE') {
        requestAnimationFrame(processImage);
      }
    };

    processImage();
  };

  // PROCESAMIENTO ÚNICO DE SEÑALES - ESTRICTO
  useEffect(() => {
    if (!lastSignal) return;

    setSignalQuality(lastSignal.quality);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    // ===== SIN DEDO = SIN DATOS =====
    // Si no hay dedo detectado, TODOS los valores son 0
    if (!lastSignal.fingerDetected) {
      setHeartRate(0);
      setHeartbeatSignal(0);
      setBeatMarker(0);
      // NO procesar signos vitales sin dedo
      return;
    }

    // ===== CON DEDO DETECTADO: PROCESAMIENTO REAL =====
    const heartBeatResult = processHeartBeat(
      lastSignal.filteredValue, 
      true, // dedo confirmado
      lastSignal.timestamp
    );
    
    setHeartRate(heartBeatResult.bpm);
    setHeartbeatSignal(lastSignal.filteredValue);
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    
    // Alimentar optimizador multicanal
    pushRawSample(lastSignal.timestamp, lastSignal.filteredValue, lastSignal.quality);
    const channelOutputs = compute();

    // Feedback multicanal cuando calidad baja
    if (channelOutputs) {
      const channels: Array<'heart' | 'spo2' | 'bloodPressure' | 'hemoglobin' | 'glucose' | 'lipids'> = ['heart','spo2','bloodPressure','hemoglobin','glucose','lipids'];
      channels.forEach((ch) => {
        const out = channelOutputs[ch];
        if (out && out.quality < 55) {
          pushFeedback(ch, out.feedback || { desiredGain: 1.05, confidence: 0.3 });
        }
      });
    }
    
    // PROCESAR SIGNOS VITALES solo con calidad mínima
    if (lastSignal.quality >= 25) {
      const vitals = channelOutputs
        ? processVitalChannels(channelOutputs, heartBeatResult.rrData)
        : processVitalSigns(lastSignal.filteredValue, heartBeatResult.rrData);
      
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

  // CONTROL DE CALIBRACIÓN ÚNICO
  useEffect(() => {
    if (!isCalibrating) return;
    
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
        console.log(`✅ Calibración ÚNICA finalizada - ${sessionIdRef.current}`);
        
        if (navigator.vibrate) {
          navigator.vibrate([100]);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  // TOGGLE ÚNICO
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
      paddingTop: '0px', // Pantalla completamente inmersiva
      paddingBottom: '0px', // Sin padding para máxima inmersión
      touchAction: 'none', // Prevenir gestos del navegador
      userSelect: 'none', // Prevenir selección de texto
      WebkitTouchCallout: 'none', // iOS: prevenir callouts
      WebkitUserSelect: 'none' // WebKit: prevenir selección
    }}>
      {/* RR INTERVALS OVERLAY REMOVIDO PARA PANTALLA INMERSIVA */}

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
          {/* HEADER DE ESTADO ÚNICO */}
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

          {/* PANEL DE DEBUG ÚNICO */}
          <div className="px-4 py-1 flex justify-around items-center bg-black/10 text-white text-sm">
            <div>Procesando: {isProcessing ? 'Sí' : 'No'}</div>
            <div>Frames: {framesProcessed}</div>
            <div>Calibrando: {isCalibrating ? 'Sí' : 'No'}</div>
            <div>Sesión: {sessionIdRef.current.slice(-8)}</div>
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

          {/* BOTONERA ÚNICA */}
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
