import React, { useState, useRef, useEffect } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import CameraPreview from "@/components/CameraPreview";
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
    isCalibrating: isHeartBeatCalibrating,
    calibrationProgress: heartBeatCalibrationProgress,
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
    if (systemState.current !== 'IDLE') {
      console.log('⚠️ No se puede iniciar, estado actual:', systemState.current);
      return;
    }
    
    console.log('🚀 Iniciando monitoreo...');
    systemState.current = 'STARTING';
    
    if (navigator.vibrate) {
      navigator.vibrate([200]);
    }
    
    // Reset previo para asegurar estado limpio
    frameLoopActiveRef.current = false;
    if (frameLoopIdRef.current) {
      cancelAnimationFrame(frameLoopIdRef.current);
      frameLoopIdRef.current = null;
    }
    videoElementRef.current = null;
    
    enterFullScreen();
    setShowResults(false);
    setElapsedTime(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    // Iniciar procesador ANTES de encender cámara
    startProcessing();
    
    // Encender cámara (esto disparará handleStreamReady)
    setIsCameraOn(true);
    setIsMonitoring(true);
    
    startAutoCalibration();
    
    // Limpiar timer previo si existe
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
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
    console.log('✅ Monitoreo activo');
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
    console.log('🛑 Finalizando medición...');
    
    // 1. PRIMERO: Detener el loop de frames
    frameLoopActiveRef.current = false;
    if (frameLoopIdRef.current) {
      cancelAnimationFrame(frameLoopIdRef.current);
      frameLoopIdRef.current = null;
    }
    
    // 2. Detener timer
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    // 3. Detener procesadores ANTES de cambiar estados
    stopProcessing();
    
    if (isCalibrating) {
      forceCalibrationCompletion();
    }
    
    // 4. Guardar resultados antes de resetear
    const savedResults = resetVitalSigns();
    
    // 5. Detener cámara (cambiando isCameraOn)
    setIsCameraOn(false);
    
    // 6. Limpiar stream manualmente
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      setCameraStream(null);
    }
    
    // 7. Actualizar estados UI
    setIsMonitoring(false);
    setIsCalibrating(false);
    
    if (savedResults) {
      setVitalSigns(savedResults);
      setShowResults(true);
    }
    
    setElapsedTime(0);
    setSignalQuality(0);
    setCalibrationProgress(0);
    
    // 8. Limpiar video ref
    videoElementRef.current = null;
    
    systemState.current = 'IDLE';
    console.log('✅ Medición finalizada correctamente');
  };

  const handleReset = () => {
    console.log('🔄 Reset completo iniciando...');
    systemState.current = 'STOPPING';
    
    // 1. PRIMERO: Detener el loop de frames
    frameLoopActiveRef.current = false;
    if (frameLoopIdRef.current) {
      cancelAnimationFrame(frameLoopIdRef.current);
      frameLoopIdRef.current = null;
    }
    
    // 2. Detener timer
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    // 3. Detener procesadores PRIMERO
    stopProcessing();
    fullResetVitalSigns();
    resetHeartBeat();
    
    // 4. Detener cámara
    setIsCameraOn(false);
    
    // 5. Limpiar stream manualmente
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      setCameraStream(null);
    }
    
    // 6. Limpiar canvas
    if (tempCtxRef.current && tempCanvasRef.current) {
      tempCtxRef.current.clearRect(0, 0, tempCanvasRef.current.width, tempCanvasRef.current.height);
    }
    
    // 7. Limpiar video ref
    videoElementRef.current = null;
    
    // 8. Reset todos los estados
    setIsMonitoring(false);
    setShowResults(false);
    setIsCalibrating(false);
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
    console.log('✅ Reset completado');
  };

  // MANEJO DEL STREAM - MEJORADO PARA ROBUSTEZ
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  
  const handleStreamReady = (stream: MediaStream) => {
    setCameraStream(stream);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    if (frameLoopActiveRef.current) return;
    
    const videoTrack = stream.getVideoTracks()[0];
    
    // Activar flash si está disponible
    if (videoTrack?.getCapabilities?.()?.torch) {
      videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      }).catch(() => {});
    }
    
    // Crear canvas temporal para captura
    if (!tempCanvasRef.current) {
      tempCanvasRef.current = document.createElement('canvas');
      tempCtxRef.current = tempCanvasRef.current.getContext('2d', { 
        willReadFrequently: true,
        alpha: false 
      });
    }
    
    const tempCanvas = tempCanvasRef.current;
    const tempCtx = tempCtxRef.current;
    if (!tempCtx) return;
    
    // BUSCAR VIDEO POR STREAM - MÁS CONFIABLE
    // Buscar el video que tiene este stream asignado
    let videoElement: HTMLVideoElement | null = null;
    const allVideos = document.querySelectorAll('video');
    for (const v of allVideos) {
      if (v.srcObject === stream || (v as any).srcObject?.id === stream.id) {
        videoElement = v;
        break;
      }
    }
    
    // Fallback: usar primer video disponible
    if (!videoElement) {
      videoElement = allVideos[0] as HTMLVideoElement || null;
    }
    
    if (!videoElement) {
      console.error('❌ No se encontró elemento video');
      return;
    }
    
    videoElementRef.current = videoElement;
    console.log('📹 Video encontrado:', videoElement.videoWidth, 'x', videoElement.videoHeight);
    
    let lastProcessTime = 0;
    // 60 FPS para máxima precisión PPG
    const targetFrameInterval = 1000 / 60;
    
    // RESOLUCIÓN 720p para mejor detección
    const PPG_WIDTH = 1280;
    const PPG_HEIGHT = 720;
    tempCanvas.width = PPG_WIDTH;
    tempCanvas.height = PPG_HEIGHT;
    
    frameLoopActiveRef.current = true;
    
    const processImage = () => {
      // SOLO usar refs para evitar closures stale
      if (!frameLoopActiveRef.current) {
        console.log('🛑 Loop detenido por frameLoopActiveRef');
        return;
      }
      
      const video = videoElementRef.current;
      // Usar systemState.current en lugar de isMonitoring (closure)
      if (systemState.current !== 'ACTIVE' || !video) {
        frameLoopActiveRef.current = false;
        console.log('🛑 Loop detenido por estado:', systemState.current);
        return;
      }
      
      const now = Date.now();
      const timeSinceLastProcess = now - lastProcessTime;
      
      if (timeSinceLastProcess >= targetFrameInterval) {
        try {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            // Dibujar frame completo a canvas pequeño
            tempCtx.drawImage(video, 0, 0, PPG_WIDTH, PPG_HEIGHT);
            const imageData = tempCtx.getImageData(0, 0, PPG_WIDTH, PPG_HEIGHT);
            processFrame(imageData);
            lastProcessTime = now;
          }
        } catch (error) {
          console.error('Error capturando frame:', error);
          frameLoopActiveRef.current = false;
          return;
        }
      }
      
      // SOLO usar refs para la siguiente iteración
      if (frameLoopActiveRef.current && systemState.current === 'ACTIVE') {
        frameLoopIdRef.current = requestAnimationFrame(processImage);
      } else {
        frameLoopActiveRef.current = false;
        frameLoopIdRef.current = null;
      }
    };

    // Esperar a que el video esté listo antes de iniciar el loop
    let startLoopTimeout: number | null = null;
    const startLoop = () => {
      // Verificar estado antes de continuar
      if (systemState.current !== 'ACTIVE' || !frameLoopActiveRef.current) {
        return;
      }
      
      if (videoElement && videoElement.readyState >= 2) {
        console.log('✅ Iniciando captura de frames');
        frameLoopIdRef.current = requestAnimationFrame(processImage);
      } else {
        startLoopTimeout = window.setTimeout(startLoop, 100);
      }
    };
    
    startLoop();
  };

  // PROCESAMIENTO DE SEÑALES - SIEMPRE VISUALIZA, SOLO PROCESA CON SANGRE
  const vitalSignsFrameCounter = useRef<number>(0);
  const VITALS_PROCESS_EVERY_N_FRAMES = 5;
  
  useEffect(() => {
    if (!lastSignal) return;

    setSignalQuality(lastSignal.quality);
    
    // SIEMPRE actualizar la señal para el gráfico (visualización)
    const signalValue = lastSignal.filteredValue;
    setHeartbeatSignal(signalValue);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    // CRÍTICO: fingerDetected ahora significa "SANGRE REAL DETECTADA"
    const hasBlood = lastSignal.fingerDetected;
    
    // Si NO hay sangre real, degradar BPM pero seguir mostrando señal
    if (!hasBlood) {
      setHeartRate(prev => prev > 0 ? Math.max(0, prev * 0.95) : 0);
      setBeatMarker(0);
      return; // NO PROCESAR LATIDOS SIN SANGRE
    }

    // PROCESAMIENTO DE LATIDOS - Solo si hay sangre
    const heartBeatResult = processHeartBeat(
      signalValue,
      true, // fingerDetected ya validado arriba
      lastSignal.timestamp
    );
    
    setHeartRate(heartBeatResult.bpm);
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    
    // THROTTLE del procesamiento de signos vitales
    vitalSignsFrameCounter.current++;
    
    if (vitalSignsFrameCounter.current >= VITALS_PROCESS_EVERY_N_FRAMES) {
      vitalSignsFrameCounter.current = 0;
      
      // Solo procesar signos vitales si hay sangre Y intervalos RR
      if (heartBeatResult.rrData && heartBeatResult.rrData.intervals.length >= 3) {
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
        {/* Panel de diagnóstico removido - tapaba los displays */}
        
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
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* HEADER - Tiempo + Estado de calibración */}
          <div className="px-4 py-2 flex justify-between items-center bg-black/30">
            <div className="text-white text-xl font-bold">
              {isMonitoring ? `${60 - elapsedTime}s` : "LISTO"}
            </div>
            
            {/* Indicador de calibración */}
            {isMonitoring && isHeartBeatCalibrating && (
              <div className="flex items-center gap-2 bg-amber-500/20 px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                <span className="text-amber-300 text-sm font-medium">
                  Calibrando {heartBeatCalibrationProgress}%
                </span>
              </div>
            )}
            
            {/* Indicador de listo */}
            {isMonitoring && !isHeartBeatCalibrating && (
              <div className="flex items-center gap-2 bg-emerald-500/20 px-3 py-1 rounded-full">
                <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                <span className="text-emerald-300 text-sm font-medium">
                  Detectando
                </span>
              </div>
            )}
          </div>

          <div className="flex-1">
            <PPGSignalMeter 
              value={heartbeatSignal}
              quality={lastSignal?.quality || 0}
              isFingerDetected={lastSignal?.fingerDetected || false}
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
              diagnosticMessage={lastSignal?.diagnostics?.message}
              isPeak={beatMarker === 1}
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
