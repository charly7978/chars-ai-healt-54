
import React, { useState, useRef, useEffect } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  // ESTADO UNIFICADO - ELIMINADAS TODAS LAS DUPLICIDADES
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [signalQuality, setSignalQuality] = useState(0);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0,
    pressure: "--/--",
    arrhythmiaStatus: "--",
    glucose: 0,
    lipids: { totalCholesterol: 0, triglycerides: 0 },
    hemoglobin: 0
  });
  const [heartRate, setHeartRate] = useState(0);
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [beatMarker, setBeatMarker] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState<VitalSignsResult['calibration']>();
  
  // REFERENCIAS UNIFICADAS - SIN DUPLICIDADES
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  const processingStateRef = useRef<'IDLE' | 'STARTING' | 'ACTIVE' | 'STOPPING'>('IDLE');
  const sessionIdRef = useRef<string>("");
  
  // HOOKS UNIFICADOS - UNA SOLA INSTANCIA DE CADA UNO
  const { 
    startProcessing, 
    stopProcessing, 
    lastSignal, 
    processFrame, 
    isProcessing, 
    framesProcessed 
  } = useSignalProcessor();
  
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState,
    reset: resetHeartBeat
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

  // GENERADOR DE SESSION ID ÚNICO PARA PREVENIR DUPLICIDADES
  useEffect(() => {
    const randomBytes = new Uint32Array(2);
    crypto.getRandomValues(randomBytes);
    sessionIdRef.current = `session_${randomBytes[0].toString(36)}_${randomBytes[1].toString(36)}`;
    console.log(`🚀 NUEVA SESIÓN UNIFICADA: ${sessionIdRef.current}`);
  }, []);

  // PANTALLA COMPLETA UNIFICADA
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
      console.log(`📱 Pantalla completa activada - ${sessionIdRef.current}`);
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

  // INICIALIZACIÓN AUTOMÁTICA DE PANTALLA COMPLETA
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

  // PREVENIR SCROLL UNIFICADO
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

  // SINCRONIZACIÓN DE RESULTADOS VÁLIDOS
  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
      console.log(`✅ Resultados válidos sincronizados - ${sessionIdRef.current}`, lastValidResults);
    }
  }, [lastValidResults, isMonitoring]);

  // FUNCIÓN UNIFICADA DE INICIO - ELIMINA DUPLICIDADES
  const startMonitoring = () => {
    // PREVENIR MÚLTIPLES INICIALIZACIONES PARALELAS
    if (processingStateRef.current !== 'IDLE') {
      console.warn(`⚠️ Inicio bloqueado - Estado actual: ${processingStateRef.current} - ${sessionIdRef.current}`);
      return;
    }
    
    processingStateRef.current = 'STARTING';
    console.log(`🎬 INICIO UNIFICADO DE MEDICIÓN - ${sessionIdRef.current}`);
    
    // UN SOLO BEEP DE ARRANQUE
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    
    enterFullScreen();
    setIsMonitoring(true);
    setIsCameraOn(true);
    setShowResults(false);
    
    // INICIAR PROCESAMIENTO UNA SOLA VEZ
    startProcessing();
    
    // RESETEAR VALORES UNA SOLA VEZ
    setElapsedTime(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    // CALIBRACIÓN AUTOMÁTICA UNA SOLA VEZ
    console.log(`🔧 Iniciando calibración unificada - ${sessionIdRef.current}`);
    startAutoCalibration();
    
    // TEMPORIZADOR UNIFICADO
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
    
    processingStateRef.current = 'ACTIVE';
    console.log(`✅ Medición iniciada exitosamente - ${sessionIdRef.current}`);
  };

  // CALIBRACIÓN UNIFICADA SIN DUPLICIDADES
  const startAutoCalibration = () => {
    if (isCalibrating) return; // PREVENIR DUPLICIDADES
    
    console.log(`🎯 Calibración automática iniciada - ${sessionIdRef.current}`);
    setIsCalibrating(true);
    startCalibration();
  };

  // FINALIZACIÓN UNIFICADA
  const finalizeMeasurement = () => {
    if (processingStateRef.current === 'STOPPING' || processingStateRef.current === 'IDLE') {
      return;
    }
    
    processingStateRef.current = 'STOPPING';
    console.log(`🏁 FINALIZANDO MEDICIÓN UNIFICADA - ${sessionIdRef.current}`);
    
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
    setCalibrationProgress(undefined);
    
    processingStateRef.current = 'IDLE';
    console.log(`✅ Medición finalizada - ${sessionIdRef.current}`);
  };

  // RESET COMPLETO UNIFICADO
  const handleReset = () => {
    processingStateRef.current = 'STOPPING';
    console.log(`🔄 RESET COMPLETO UNIFICADO - ${sessionIdRef.current}`);
    
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
    
    // RESETEAR TODOS LOS ESTADOS
    setElapsedTime(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setVitalSigns({ 
      spo2: 0,
      pressure: "--/--",
      arrhythmiaStatus: "--",
      glucose: 0,
      lipids: { totalCholesterol: 0, triglycerides: 0 },
      hemoglobin: 0
    });
    setArrhythmiaCount("--");
    setSignalQuality(0);
    lastArrhythmiaData.current = null;
    setCalibrationProgress(undefined);
    arrhythmiaDetectedRef.current = false;
    
    processingStateRef.current = 'IDLE';
    console.log(`✅ Reset completado - ${sessionIdRef.current}`);
  };

  // MANEJO UNIFICADO DEL STREAM DE CÁMARA
  const handleStreamReady = (stream: MediaStream) => {
    if (!isMonitoring || processingStateRef.current !== 'ACTIVE') return;
    
    console.log(`📹 Stream de cámara listo - ${sessionIdRef.current}`);
    
    const videoTrack = stream.getVideoTracks()[0];
    
    // ACTIVAR LINTERNA UNA SOLA VEZ
    if (videoTrack.getCapabilities()?.torch) {
      videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      }).catch(err => console.error("Error linterna:", err));
    }
    
    // PROCESAMIENTO UNIFICADO DE FRAMES
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', {willReadFrequently: true});
    if (!tempCtx) return;
    
    let lastProcessTime = 0;
    const targetFrameInterval = 1000/30; // 30 FPS PRECISOS
    
    const videoElement = document.querySelector('video') as HTMLVideoElement;
    if (!videoElement) return;
    
    const processImage = async () => {
      if (!isMonitoring || processingStateRef.current !== 'ACTIVE' || !videoElement) return;
      
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
      
      if (isMonitoring && processingStateRef.current === 'ACTIVE') {
        requestAnimationFrame(processImage);
      }
    };

    processImage();
  };

  // PROCESAMIENTO UNIFICADO DE SEÑALES - ELIMINA DUPLICIDADES
  useEffect(() => {
    if (!lastSignal) return;

    // ACTUALIZAR CALIDAD SIEMPRE
    setSignalQuality(lastSignal.quality);
    
    // SOLO PROCESAR SI ESTÁ MONITOREANDO Y EN ESTADO ACTIVO
    if (!isMonitoring || processingStateRef.current !== 'ACTIVE') return;
    
    const MIN_SIGNAL_QUALITY = 40;
    
    // VALIDACIÓN UNIFICADA
    if (!lastSignal.fingerDetected || lastSignal.quality < MIN_SIGNAL_QUALITY) {
      setHeartRate(0);
      setHeartbeatSignal(0);
      setBeatMarker(0);
      return;
    }

    // PROCESAMIENTO UNIFICADO DE LATIDOS
    const heartBeatResult = processHeartBeat(
      lastSignal.filteredValue, 
      lastSignal.fingerDetected, 
      lastSignal.timestamp
    );
    
    setHeartRate(heartBeatResult.bpm);
    setHeartbeatSignal(lastSignal.filteredValue);
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    
    // PROCESAMIENTO UNIFICADO DE SIGNOS VITALES
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
  }, [lastSignal, isMonitoring, processHeartBeat, processVitalSigns, setArrhythmiaState]);

  // CONTROL DE CALIBRACIÓN UNIFICADO
  useEffect(() => {
    if (!isCalibrating) return;
    
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);

      if (!currentProgress?.isCalibrating) {
        clearInterval(interval);
        setIsCalibrating(false);
        console.log(`✅ Calibración finalizada - ${sessionIdRef.current}`);
        
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  // FUNCIÓN TOGGLE UNIFICADA
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
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)'
    }}>
      {/* DEBUG DE INTERVALOS RR */}
      {rrIntervals.length > 0 && (
        <div className="absolute top-4 left-4 text-white z-20 bg-black/50 p-2 rounded">
          RR: {rrIntervals.map(i => i + 'ms').join(', ')}
        </div>
      )}

      {/* OVERLAY DE PANTALLA COMPLETA */}
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
        <div className="absolute inset-0">
          <CameraView 
            onStreamReady={handleStreamReady}
            isMonitoring={isCameraOn}
            isFingerDetected={lastSignal?.fingerDetected}
            signalQuality={signalQuality}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* HEADER DE ESTADO UNIFICADO */}
          <div className="px-4 py-2 flex justify-around items-center bg-black/20">
            <div className="text-white text-lg">
              Calidad: {signalQuality}
            </div>
            <div className="text-white text-lg">
              {lastSignal?.fingerDetected ? "Huella Detectada" : "Huella No Detectada"}
            </div>
            <div className="text-white text-lg">
              Estado: {processingStateRef.current}
            </div>
          </div>

          {/* PANEL DE INFORMACIÓN UNIFICADO */}
          <div className="px-4 py-1 flex justify-around items-center bg-black/10 text-white text-sm">
            <div>Procesando: {isProcessing ? 'Sí' : 'No'}</div>
            <div>Frames: {framesProcessed}</div>
            <div>Calibrando: {isCalibrating ? 'Sí' : 'No'}</div>
            <div>Sesión: {sessionIdRef.current.slice(-8)}</div>
          </div>

          {/* DEBUG PANEL UNIFICADO */}
          <details className="px-4 bg-black/10 text-white text-xs overflow-auto max-h-40">
            <summary className="cursor-pointer">Debug Signal Info</summary>
            <pre className="whitespace-pre-wrap text-xs">
              Calidad Señal: {lastSignal?.quality || 0}
              {'\n'}Dedo Detectado: {lastSignal?.fingerDetected ? 'Sí' : 'No'}
              {'\n'}Valor Crudo: {lastSignal?.rawValue || 0}
              {'\n'}Valor Filtrado: {lastSignal?.filteredValue || 0}
              {'\n'}Estado Procesamiento: {processingStateRef.current}
              {'\n'}Sesión ID: {sessionIdRef.current}
            </pre>
          </details>

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
                value={vitalSigns.pressure}
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

          {/* BOTONERA UNIFICADA */}
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
