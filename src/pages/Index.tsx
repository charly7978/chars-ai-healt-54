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
    pressure: "--/--",
    arrhythmiaStatus: "--",
    glucose: 0,
    lipids: {
      totalCholesterol: 0,
      triglycerides: 0
    },
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
  const measurementTimerRef = useRef<number | null>(null);
  const [lastArrhythmiaData, setLastArrhythmiaData] = useState<{
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  
  const { startProcessing, stopProcessing, lastSignal, processFrame, isProcessing, framesProcessed, signalStats, qualityTransitions, isCalibrating: isProcessorCalibrating } = useSignalProcessor();
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState 
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

  const enterFullScreen = async () => {
    try {
      if (!isFullscreen) {
        const docEl = document.documentElement;
        
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if ((docEl as any).webkitRequestFullscreen) {
          await (docEl as any).webkitRequestFullscreen();
        } else if ((docEl as any).msRequestFullscreen) {
          await (docEl as any).msRequestFullscreen();
        } else if ((docEl as any).mozRequestFullScreen) {
          await (docEl as any).mozRequestFullScreen();
        }
        
        // Bloquear orientación si es dispositivo móvil
        if (screen.orientation && screen.orientation.lock) {
          try {
            await screen.orientation.lock('portrait');
            console.log('Orientación portrait bloqueada');
          } catch (err) {
            console.log('Error al bloquear la orientación:', err);
          }
        }
        
        setIsFullscreen(true);
        console.log("Pantalla completa activada");
      }
    } catch (err) {
      console.log('Error al entrar en pantalla completa:', err);
    }
  };
  
  const exitFullScreen = () => {
    try {
      if (isFullscreen) {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        } else if ((document as any).msExitFullscreen) {
          (document as any).msExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          (document as any).mozCancelFullScreen();
        }
        
        // Desbloquear orientación si es necesario
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock();
          console.log('Orientación desbloqueada');
        }
        
        setIsFullscreen(false);
      }
    } catch (err) {
      console.log('Error al salir de pantalla completa:', err);
    }
  };
  
  // Activar pantalla completa automáticamente al cargar la página
  useEffect(() => {
    setTimeout(() => {
      enterFullScreen();
    }, 1000); // Pequeño retraso para asegurar que todo está cargado
    
    // Detectar cambios en el estado de pantalla completa
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement || 
        (document as any).msFullscreenElement || 
        (document as any).mozFullScreenElement
      ));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      
      // Asegurarse de salir del modo pantalla completa al desmontar
      exitFullScreen();
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

  const startMonitoring = () => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      enterFullScreen();
      setIsMonitoring(true);
      setIsCameraOn(true);
      setShowResults(false);
      
      // Iniciar procesamiento de señal
      startProcessing();
      
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
    }
  };

  const startAutoCalibration = () => {
    console.log("Iniciando auto-calibración real con indicadores visuales");
    setIsCalibrating(true);
    
    // Iniciar la calibración en el procesador
    startCalibration();
    
    // El progreso de la calibración será actualizado por el hook useVitalSignsProcessor
    // y reflejado a través del estado calibrationProgress.
    
    // Eliminar la simulación visual con setInterval y setTimeout
    // La lógica de calibración es ahora completamente manejada por el procesador
  };

  const finalizeMeasurement = () => {
    console.log("Finalizando medición: manteniendo resultados");
    
    if (isCalibrating) {
      console.log("Calibración en progreso al finalizar, forzando finalización");
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
  };

  const handleReset = () => {
    console.log("Reseteando completamente la aplicación");
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
    setElapsedTime(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setVitalSigns({ 
      spo2: 0,
      pressure: "--/--",
      arrhythmiaStatus: "--",
      glucose: 0,
      lipids: {
        totalCholesterol: 0,
        triglycerides: 0
      },
      hemoglobin: 0
    });
    setArrhythmiaCount("--");
    setSignalQuality(0);
    setLastArrhythmiaData(null);
    setCalibrationProgress(undefined);
  };

  // HANDLER DESBLOQUEADO: Procesar SIEMPRE señal PPG válida  
  const handlePPGSignal = (ppgValue: number, fingerDetected: boolean) => {
    // PROCESAMIENTO DIRECTO SIN BLOQUEOS
    if (!fingerDetected) {
      console.log('Index.tsx: ❌ Sin dedo detectado - ignorando señal');
      return; 
    }
    
    console.log('Index.tsx: 📡🔥 PROCESANDO SEÑAL PPG DESBLOQUEADA', {
      ppgValue: ppgValue.toFixed(4),
      fingerDetected,
      timestamp: new Date().toISOString(),
      'ESTADO': 'DESBLOQUEADO - Procesando directo'
    });
    
    // PROCESAMIENTO DIRECTO DESBLOQUEADO
    console.log('Index.tsx: ❤️ Llamando processHeartBeat con valor:', ppgValue.toFixed(4));
    const heartBeatResult = processHeartBeat(ppgValue, fingerDetected);
    
    console.log('Index.tsx: 🩺 Llamando processVitalSigns con resultado heart:', heartBeatResult);
    const vitalSignsResult = processVitalSigns(ppgValue, heartBeatResult.rrData);
    
    // DETECCIÓN DE LATIDO REAL = COORDINACIÓN TOTAL
    if (heartBeatResult.isPeak) {
      console.log('Index.tsx: 🔥 LATIDO REAL DETECTADO - Coordinando TODO', {
        timestamp: Date.now(),
        ppgValue: ppgValue.toFixed(4),
        bpm: heartBeatResult.bpm,
        confidence: heartBeatResult.confidence,
        signalQuality: heartBeatResult.signalQuality
      });
      
      // MARCADOR DE LATIDO DINÁMICO (RESTAURADO A FUNCIONAMIENTO ANTERIOR)
      setBeatMarker(ppgValue * 100); // AMPLIFICAR para visualización clara como antes
      
      // VIBRACIÓN COORDINADA (no duplicar la del HeartBeatProcessor)
      // HeartBeatProcessor ya maneja beep + vibración internamente
      
    } else {
      // NO hay latido = NO hay pico visual
      setBeatMarker(0);
    }
    
    // Actualizar estado general
    setSignalQuality(heartBeatResult.signalQuality || 0);
    setVitalSigns(vitalSignsResult);
    
    console.log('Index.tsx: ✅ Procesamiento PPG coordinado', {
      bpm: heartBeatResult.bpm,
      isPeak: heartBeatResult.isPeak,
      beatMarker: heartBeatResult.isPeak ? ppgValue * 100 : 0,
      spo2: vitalSignsResult.spo2,
      signalQuality: heartBeatResult.signalQuality
    });
  };

  const handleStreamReady = (stream: MediaStream) => {
    if (!isMonitoring) return;
    
    const videoTrack = stream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(videoTrack);
    
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
    
    // Crearemos un contexto dedicado para el procesamiento de imagen
    const enhanceCanvas = document.createElement('canvas');
    const enhanceCtx = enhanceCanvas.getContext('2d', {willReadFrequently: true});
    enhanceCanvas.width = 320;  // Tamaño óptimo para procesamiento PPG
    enhanceCanvas.height = 240;
    
    const processImage = async () => {
      if (!isMonitoring) return;
      
      const now = Date.now();
      const timeSinceLastProcess = now - lastProcessTime;
      
      // Control de tasa de frames para no sobrecargar el dispositivo
      if (timeSinceLastProcess >= targetFrameInterval) {
        try {
          // Capturar frame usando el método correcto
          const blob = await imageCapture.takePhoto();
          
          // Crear objeto Image desde el Blob
          const img = new Image();
          const url = URL.createObjectURL(blob);
          
          img.onload = () => {
            URL.revokeObjectURL(url);
            
            // Configurar tamaño adecuado del canvas para procesamiento
            const targetWidth = Math.min(320, img.width);
            const targetHeight = Math.min(240, img.height);
            
            tempCanvas.width = targetWidth;
            tempCanvas.height = targetHeight;
            
            // Dibujar el frame en el canvas
            tempCtx.drawImage(
              img, 
              0, 0, img.width, img.height, 
              0, 0, targetWidth, targetHeight
            );
            
            // Mejorar la imagen para detección PPG
            if (enhanceCtx) {
              // Resetear canvas
              enhanceCtx.clearRect(0, 0, enhanceCanvas.width, enhanceCanvas.height);
              
              // Dibujar en el canvas de mejora
              enhanceCtx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);
              
              // Opcionales: Ajustes para mejorar la señal roja
              enhanceCtx.globalCompositeOperation = 'source-over';
              enhanceCtx.fillStyle = 'rgba(255,0,0,0.05)';  // Sutil refuerzo del canal rojo
              enhanceCtx.fillRect(0, 0, enhanceCanvas.width, enhanceCanvas.height);
              enhanceCtx.globalCompositeOperation = 'source-over';
            
              // Obtener datos de la imagen mejorada
              const imageData = enhanceCtx.getImageData(0, 0, enhanceCanvas.width, enhanceCanvas.height);
              
              // Procesar el frame mejorado
              processFrame(imageData);
            } else {
              // Fallback a procesamiento normal
              const imageData = tempCtx.getImageData(0, 0, targetWidth, targetHeight);
              processFrame(imageData);
            }
            
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
          };
          
          img.onerror = () => {
            URL.revokeObjectURL(url);
            console.error('Error cargando imagen capturada');
          };
          
          img.src = url;
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

  useEffect(() => {
      if (!lastSignal) {
        console.log("[DIAG] Index.tsx: lastSignal es nulo o indefinido.");
        return;
      }

      console.log("[DIAG] Index.tsx: Procesando lastSignal", {
        timestamp: new Date(lastSignal.timestamp).toISOString(),
        fingerDetected: lastSignal.fingerDetected,
        quality: lastSignal.quality,
        rawValue: lastSignal.rawValue,
        filteredValue: lastSignal.filteredValue,
        isMonitoring: isMonitoring
      });

      // Actualizar calidad siempre
      setSignalQuality(lastSignal.quality);
      // Si no está monitoreando, no procesar
      if (!isMonitoring) {
        console.log("[DIAG] Index.tsx: No está monitoreando, ignorando procesamiento de latidos y signos vitales.");
        return;
      }
      
      // Umbral mínimo de calidad para medir
      const MIN_SIGNAL_QUALITY_TO_MEASURE = 30;
      // Si no hay dedo válido o calidad insuficiente, resetear indicadores
      if (!lastSignal.fingerDetected || lastSignal.quality < MIN_SIGNAL_QUALITY_TO_MEASURE) {
        console.log("[DIAG] Index.tsx: Dedo NO detectado o calidad insuficiente", {
          fingerDetected: lastSignal.fingerDetected,
          quality: lastSignal.quality,
          minRequiredQuality: MIN_SIGNAL_QUALITY_TO_MEASURE
        });
        setHeartRate(0);
        setHeartbeatSignal(0);
        setBeatMarker(0);
        return;
      }

    console.log("[DIAG] Index.tsx: Dedo detectado y calidad suficiente. Procesando latidos y signos vitales.");
    // Señal válida, procesar latidos y signos vitales
    const heartBeatResult = processHeartBeat(lastSignal.filteredValue);
    setHeartRate(heartBeatResult.bpm);
    setHeartbeatSignal(heartBeatResult.filteredValue);
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    // Actualizar últimos intervalos RR para debug
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    const vitals = processVitalSigns(lastSignal.filteredValue, heartBeatResult.rrData);
    if (vitals) {
      setVitalSigns(vitals);
      if (vitals.lastArrhythmiaData) {
        setLastArrhythmiaData(vitals.lastArrhythmiaData);
        const [status, count] = vitals.arrhythmiaStatus.split('|');
        setArrhythmiaCount(count || "0");
        const isArrhythmiaDetected = status === "ARRITMIA DETECTADA";
        if (isArrhythmiaDetected !== arrhythmiaDetectedRef.current) {
          arrhythmiaDetectedRef.current = isArrhythmiaDetected;
          setArrhythmiaState(isArrhythmiaDetected);
          if (isArrhythmiaDetected) {
            toast({ title: "¡Arritmia detectada!", description: "Se activará un sonido distintivo con los latidos.", variant: "destructive", duration: 3000 });
          }
        }
      }
    }
  }, [lastSignal, isMonitoring, processHeartBeat, processVitalSigns, setArrhythmiaState]);

  // Referencia para activar o desactivar el sonido de arritmia
  const arrhythmiaDetectedRef = useRef(false);
  
  // Nueva función para alternar medición
  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      startMonitoring();
    }
  };

  // Observar el progreso real de la calibración desde el procesador de signos vitales
  useEffect(() => {
    if (isCalibrating) {
      const interval = setInterval(() => {
        const currentProgress = getCalibrationProgress();
        setCalibrationProgress(currentProgress);

        if (!currentProgress?.isCalibrating) {
          clearInterval(interval);
          console.log("Calibración finalizada según el procesador.");
          setIsCalibrating(false);
          if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
          }
        }
      }, 500); // Actualizar el progreso cada 500ms

      return () => clearInterval(interval);
    }
  }, [isCalibrating, getCalibrationProgress]);

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
      {/* Debug overlay de intervalos RR */}
      {rrIntervals.length > 0 && (
        <div className="absolute top-4 left-4 text-white z-20 bg-black/50 p-2 rounded">
          Últimos intervalos RR: {rrIntervals.map(i => i + ' ms').join(', ')}
        </div>
      )}
      {/* Overlay button for re-entering fullscreen if user exits */}
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
            onPPGSignal={handlePPGSignal}
            isMonitoring={isCameraOn}
            isFingerDetected={lastSignal?.fingerDetected}
            signalQuality={signalQuality}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* Se agrega header para sensor de calidad y estado de huella digital */}
          <div className="px-4 py-2 flex justify-around items-center bg-black/20">
            <div className="text-white text-lg">
              Calidad: {signalQuality}
            </div>
            <div className="text-white text-lg">
              {lastSignal?.fingerDetected ? "Huella Detectada" : "Huella No Detectada"}
            </div>
          </div>
          {/* Panel de estado */}
          <div className="px-4 py-1 flex justify-around items-center bg-black/10 text-white text-sm">
            <div>Procesando: {isProcessing ? 'Sí' : 'No'}</div>
            <div>Frames: {framesProcessed}</div>
            <div>Calibrando: {isProcessorCalibrating ? 'Sí' : 'No'}</div>
          </div>
          {/* Panel de debug */}
          <details className="px-4 bg-black/10 text-white text-xs overflow-auto max-h-40">
            <summary className="cursor-pointer">Debug Signal Stats</summary>
            <pre className="whitespace-pre-wrap text-xs">
              {JSON.stringify(signalStats, null, 2)}
              {'\n'}Quality Transitions:{'\n'}{JSON.stringify(qualityTransitions, null, 2)}
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
              rawArrhythmiaData={lastArrhythmiaData}
              preserveResults={showResults}
            />
          </div>

          {/* Contenedor de los displays ampliado y con mayor espaciamiento */}
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

          {/* Botonera inferior: botón de iniciar/detener y de reset en fila */}
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
