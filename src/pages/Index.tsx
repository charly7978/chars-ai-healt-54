
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
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [signalQuality, setSignalQuality] = useState(0);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0,
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
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  
<<<<<<< HEAD
  // Usar el nuevo sistema multicanal
  const { handleSample, lastResult, adjustChannelGain } = useSignalProcessor(8, 6);

=======
  const systemState = useRef<'IDLE' | 'STARTING' | 'ACTIVE' | 'STOPPING' | 'CALIBRATING'>('IDLE');
  const sessionIdRef = useRef<string>("");
  const initializationLock = useRef<boolean>(false);
  
  // HOOKS
  const { 
    startProcessing, 
    stopProcessing, 
    lastSignal, 
    handleSample,
    isProcessing, 
    framesProcessed,
    debugInfo: signalDebugInfo,
    lastResult
  } = useSignalProcessor();
  
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState,
    reset: resetHeartBeat,
    debugInfo: heartDebugInfo
  } = useHeartBeatProcessor();
  
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
  const { 
    processSignal: processVitalSigns, 
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    lastValidResults,
    startCalibration,
    forceCalibrationCompletion,
    getCalibrationProgress
  } = useVitalSignsProcessor();

<<<<<<< HEAD
  // Efecto para procesar los resultados del nuevo sistema multicanal
  useEffect(() => {
    if (lastResult) {
      // Actualizar calidad de señal
      setSignalQuality(lastResult.aggregatedQuality);
      
      // Actualizar frecuencia cardíaca si está disponible
      if (lastResult.aggregatedBPM) {
        setHeartRate(lastResult.aggregatedBPM);
        
        // Procesar con el sistema de signos vitales existente
        if (lastResult.fingerDetected) {
          // Simular señal PPG para mantener compatibilidad
          const simulatedPPGValue = lastResult.aggregatedQuality * 2.5; // Escalar calidad a valor PPG
          processVitalSigns(simulatedPPGValue);
        }
      }
      
      // Actualizar estado de detección de dedo
      if (lastResult.fingerDetected !== isCameraOn) {
        setIsCameraOn(lastResult.fingerDetected);
      }
      
      // Extraer intervalos RR del mejor canal
      const bestChannel = lastResult.channels.reduce((best, current) => 
        current.quality > best.quality ? current : best
      );
      
      if (bestChannel.rrIntervals.length > 0) {
        setRRIntervals(bestChannel.rrIntervals);
      }
    }
  }, [lastResult, isCameraOn, processVitalSigns]);
=======
  useEffect(() => {
    if (initializationLock.current) return;
    
    initializationLock.current = true;
    const randomBytes = new Uint32Array(3);
    crypto.getRandomValues(randomBytes);
    sessionIdRef.current = `main_${randomBytes[0].toString(36)}_${randomBytes[1].toString(36)}_${randomBytes[2].toString(36)}`;
    
    console.log(`🚀 INICIALIZACIÓN ÚNICA: ${sessionIdRef.current}`);
    
    return () => {
      initializationLock.current = false;
    };
  }, []);
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8

  const enterFullScreen = async () => {
    if (isFullscreen) return;
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      }
      setIsFullscreen(true);
    } catch (err) {
      console.log('Fullscreen no disponible:', err);
    }
  };
  
  const exitFullScreen = () => {
    if (!isFullscreen) return;
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
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

  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
  }, [lastValidResults, isMonitoring]);

  const startMonitoring = () => {
<<<<<<< HEAD
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      enterFullScreen();
      setIsMonitoring(true);
      setIsCameraOn(true);
      setShowResults(false);
      
      // Iniciar procesamiento de señal
      // handleSample(); // This line is removed as per the new_code
      
      // Resetear valores
      setElapsedTime(0);
      setVitalSigns(prev => ({
        ...prev,
        arrhythmiaStatus: "SIN ARRITMIAS|0"
      }));
      
      // Iniciar calibración automática
      console.log("Iniciando fase de calibración automática");
      startAutoCalibration();
      
      // Iniciar temporizador para medición
      if (measurementTimerRef.current) {
        clearInterval(measurementTimerRef.current);
      }
      
      measurementTimerRef.current = window.setInterval(() => {
        setElapsedTime(prev => {
          const newTime = prev + 1;
          console.log(`Tiempo transcurrido: ${newTime}s`);
          
          // Finalizar medición después de 30 segundos
          if (newTime >= 30) {
            finalizeMeasurement();
            return 30;
          }
          return newTime;
        });
      }, 1000);
=======
    if (systemState.current !== 'IDLE') {
      console.warn(`⚠️ INICIO BLOQUEADO - Estado: ${systemState.current}`);
      return;
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
    }
    
    systemState.current = 'STARTING';
    console.log(`🎬 INICIO MONITOREO - ${sessionIdRef.current}`);
    
    enterFullScreen();
    setIsMonitoring(true);
    setIsCameraOn(true);
    setShowResults(false);
    
    startProcessing();
    
    setElapsedTime(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    console.log(`🔧 Iniciando calibración`);
    setIsCalibrating(true);
    startCalibration();
    
    setTimeout(() => {
      if (systemState.current === 'CALIBRATING') {
        systemState.current = 'ACTIVE';
      }
      setIsCalibrating(false);
    }, 2000);
    
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
  };

  const finalizeMeasurement = () => {
    if (systemState.current === 'STOPPING' || systemState.current === 'IDLE') return;
    
    systemState.current = 'STOPPING';
    
    if (isCalibrating) {
      forceCalibrationCompletion();
    }
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setIsCalibrating(false);
    // stopProcessing(); // This line is removed as per the new_code
    
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
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setShowResults(false);
    setIsCalibrating(false);
    // stopProcessing(); // This line is removed as per the new_code
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    fullResetVitalSigns();
    resetHeartBeat();
    
    setElapsedTime(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setVitalSigns({ 
      spo2: 0,
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
    setSignalQuality(0);
<<<<<<< HEAD
    setLastArrhythmiaData(null);
    setCalibrationProgress(undefined);
  };

  // MANEJAR PICO DETECTADO DESDE EL MONITOR CARDIACO (PPGSignalMeter)
  const handlePeakDetected = useCallback((peak: {time: number, value: number, isArrhythmia: boolean, bpm: number}) => {
    console.log('Index.tsx: Pico detectado por PPGSignalMeter', peak);
    
    // ACTUALIZAR BPM EN TIEMPO REAL
    if (peak.bpm > 0) {
      setHeartRate(peak.bpm);
      setVitalSigns(prev => ({
        ...prev,
        heartRate: peak.bpm
      }));
    }
    
    // NOTIFICAR LATIDO DETECTADO (BEEP + VIBRACIÓN)
    try {
      // BEEP SONORO
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
      
      // VIBRACIÓN
      if (navigator.vibrate) {
        navigator.vibrate([50, 25, 50]);
      }
      
      console.log('Index.tsx: Beep, vibración y BPM actualizados por pico detectado', { bpm: peak.bpm });
    } catch (error) {
      console.warn('Error en notificación de latido:', error);
    }
  }, []);

  const handleStreamReady = (stream: MediaStream) => {
    if (!isMonitoring) return;
    
    const videoTrack = stream.getVideoTracks()[0];
    
    // Asegurar que la linterna esté encendida para mediciones de PPG
    if (videoTrack.getCapabilities()?.torch) {
      console.log("Activando linterna para mejorar la señal PPG");
      videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      }).catch(err => console.error("Error activando linterna:", err));
    } else {
      console.warn("Esta cámara no tiene linterna disponible, la medición puede ser menos precisa");
    }
    
    // Crear un canvas de tamaño óptimo para el procesamiento
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', {willReadFrequently: true});
    if (!tempCtx) {
      console.error("No se pudo obtener el contexto 2D");
      return;
    }
    
    // Variables para controlar el rendimiento y la tasa de frames
    let lastProcessTime = 0;
    const targetFrameInterval = 1000/30; // Apuntar a 30 FPS para precisión
    let frameCount = 0;
    let lastFpsUpdateTime = Date.now();
    let processingFps = 0;
    
    // Obtener el elemento video para capturar frames
    const videoElement = document.querySelector('video') as HTMLVideoElement;
    if (!videoElement) {
      console.error("No se encontró el elemento video");
      return;
    }
    
    const processImage = async () => {
      if (!isMonitoring || !videoElement) return;
      
      const now = Date.now();
      const timeSinceLastProcess = now - lastProcessTime;
      
      // Control de tasa de frames para no sobrecargar el dispositivo
      if (timeSinceLastProcess >= targetFrameInterval) {
        try {
          // Verificar que el video esté listo
          if (videoElement.readyState >= 2) {
            // Configurar tamaño del canvas basado en el video
            const targetWidth = Math.min(720, videoElement.videoWidth || 720);
            const targetHeight = Math.min(240, videoElement.videoHeight || 240);
            
            tempCanvas.width = targetWidth;
            tempCanvas.height = targetHeight;
            
            // Capturar frame del video
            tempCtx.drawImage(
              videoElement, 
              0, 0, videoElement.videoWidth, videoElement.videoHeight,
              0, 0, targetWidth, targetHeight
            );
            
            // Obtener datos de la imagen
            const imageData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
            
            // Procesar el frame
            // handleSample(imageData); // This line is removed as per the new_code
            
            // Actualizar contadores para monitoreo de rendimiento
            frameCount++;
            lastProcessTime = now;
            
            // Calcular FPS cada segundo
            if (now - lastFpsUpdateTime > 1000) {
              processingFps = frameCount;
              frameCount = 0;
              lastFpsUpdateTime = now;
              console.log(`Rendimiento de procesamiento: ${processingFps} FPS`);
            }
          }
        } catch (error) {
          console.error("Error capturando frame:", error);
        }
      }
      
      // Programar el siguiente frame
      if (isMonitoring) {
        requestAnimationFrame(processImage);
      }
    };

    processImage();
  };

  // Referencia para activar o desactivar el sonido de arritmia
  const arrhythmiaDetectedRef = useRef(false);
  
  // Nueva función para alternar medición
=======
    lastArrhythmiaData.current = null;
    setCalibrationProgress(0);
    arrhythmiaDetectedRef.current = false;
    
    systemState.current = 'IDLE';
  };

  // PROCESAMIENTO CORREGIDO PARA BPM REAL
  useEffect(() => {
    if (!lastSignal || !lastResult) return;

    const bestChannel = lastResult.channels.find(ch => ch.isFingerDetected && ch.quality > 15) || lastResult.channels[0];
    setSignalQuality(bestChannel?.quality || 0);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    const MIN_SIGNAL_QUALITY = 10;
    
    if (!bestChannel?.isFingerDetected || (bestChannel?.quality || 0) < MIN_SIGNAL_QUALITY) {
      return;
    }

    const heartBeatResult = processHeartBeat(
      lastSignal.filteredValue, 
      lastSignal.fingerDetected, 
      lastSignal.timestamp
    );
    
    const finalBpm = lastResult.aggregatedBPM && lastResult.aggregatedBPM > 50 && lastResult.aggregatedBPM < 200 
      ? lastResult.aggregatedBPM 
      : (heartBeatResult.bpm && heartBeatResult.bpm > 50 && heartBeatResult.bpm < 200 ? heartBeatResult.bpm : 0);
    
    setHeartRate(finalBpm);
    setHeartbeatSignal(lastSignal.filteredValue);
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    
    const vitals = processVitalSigns(lastSignal.filteredValue, heartBeatResult.rrData);
    if (vitals) {
      setVitalSigns(vitals);
      
      if (vitals.lastArrhythmiaData) {
        lastArrhythmiaData.current = vitals.lastArrhythmiaData;
        const isArrhythmiaDetected = vitals.arrhythmiaStatus.includes("DETECTADA");
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
  }, [lastSignal, lastResult, isMonitoring, processHeartBeat, processVitalSigns, setArrhythmiaState]);

  useEffect(() => {
    if (!isCalibrating) return;
    
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
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
      {!isFullscreen && (
        <button 
          onClick={enterFullScreen}
          className="fixed inset-0 z-50 w-full h-full flex items-center justify-center bg-black/90 text-white"
        >
          <div className="text-center p-4 bg-primary/20 rounded-lg backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
            <p className="text-lg font-semibold">Toca para pantalla completa</p>
          </div>
        </button>
      )}

      <div className="flex-1 relative">
        <div className="absolute inset-0">
          {/* CameraView con el nuevo sistema multicanal */}
          <CameraView 
<<<<<<< HEAD
            onStreamReady={handleStreamReady}
            onSample={handleSample}
            isMonitoring={isMonitoring}
            targetFps={30}
            roiSize={200}
            enableTorch={true}
            coverageThresholdPixelBrightness={30}
=======
            onSample={handleSample}
            isMonitoring={isCameraOn}
            targetFps={30}
            targetW={160}
            enableTorch={true}
            isFingerDetected={lastSignal?.fingerDetected || false}
            signalQuality={signalQuality}
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
<<<<<<< HEAD
          {/* Se agrega header para sensor de calidad y estado de huella digital */}
          <div className="px-4 py-2 flex justify-around items-center bg-black/20">
            <div className="text-white text-lg">
              Calidad: {signalQuality}
            </div>
            <div className="text-white text-lg">
              {lastResult?.fingerDetected ? "Huella Detectada" : "Huella No Detectada"}
            </div>
          </div>
          {/* Panel de estado */}
          <div className="px-4 py-1 flex justify-around items-center bg-black/10 text-white text-sm">
            <div>Procesando: {isMonitoring ? 'Sí' : 'No'}</div>
            <div>Canales: {lastResult?.channels?.length || 0}</div>
            <div>Calibrando: {isCalibrating ? 'Sí' : 'No'}</div>
          </div>
          {/* Panel de debug */}
          <details className="px-4 bg-black/10 text-white text-xs overflow-auto max-h-40">
            <summary className="cursor-pointer">Debug Multicanal</summary>
            <pre className="whitespace-pre-wrap text-xs">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          </details>
          <div className="flex-1">
            <PPGSignalMeter 
              value={lastResult?.aggregatedQuality || 0}
              quality={lastResult?.aggregatedQuality || 0}
              isFingerDetected={lastResult?.fingerDetected || false}
=======
          <div className="flex-1" style={{ marginTop: '6mm' }}>
            <PPGSignalMeter 
              value={beatMarker}
              quality={signalQuality}
              isFingerDetected={lastSignal?.fingerDetected || false}
>>>>>>> ea85559876bf770fc2baa633a29716bb83d3b0b8
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
            />
          </div>

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
